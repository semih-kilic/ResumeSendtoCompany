import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import axios from 'axios';
import dns from 'dns';
import { stringify } from 'csv-stringify/sync';

// Force IPv4 first to prevent ENETUNREACH errors on networks without IPv6 routing
dns.setDefaultResultOrder('ipv4first');

import { initDatabase, getStats, getEmails, toggleExcluded, getApplications, getFitStats, updateApplicationStatus } from './db.js';
import { loadConfig, saveConfig, maskPassword } from './config.js';
import { ScanEngine } from './scan-engine.js';
import { SendEngine } from './send-engine.js';
import { SaaSEngine } from './saas-engine.js';
import { ReplyMonitor } from './reply-monitor.js';
import { WarmupEngine } from './warmup-engine.js';
import { AIAdvisor } from './ai-advisor.js';
import { NotificationEngine } from './notification-engine.js';
import { DLQRetryScheduler } from './dlq-retry-scheduler.js';
import { initSendLimits } from './send-limits.js';
import { initMetrics, logProviderUsage, getAnalyticsSummary } from './metrics.js';
import { SmartSelector } from './smart-selector.js';
import { GroupManager } from './provider-groups.js';
import providerRegistry from './provider-registry.js';

process.on('uncaughtException', (err) => {
  console.error('[FATAL-SERVER] Uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL-SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;

function resolveDataDir() {
  const configured = process.env.DATA_DIR;
  const dir = configured ? path.resolve(configured) : path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createApp() {
  const dataDir = resolveDataDir();

  // Init DB and config
  const db = initDatabase(path.join(dataDir, 'canada.db'));
  initMetrics(db);
  let config = loadConfig();

  // Init engines
  let aiAdvisor = new AIAdvisor(config);
  let scanEngine = new ScanEngine(db, config);
  let sendEngine = new SendEngine(db, config, aiAdvisor);
  let saasEngine = new SaaSEngine(db, config, aiAdvisor);
  let replyMonitor = new ReplyMonitor(db, config, aiAdvisor);
  let warmupEngine = new WarmupEngine(config);

  providerRegistry.setLogUsage((provider, action, status, durationMs, target, error) => {
    logProviderUsage({ provider, action, status, durationMs, target, error });
  });

  // Smart Provider Selector
  let smartSelector = new SmartSelector(config.smart_selector || {});
  smartSelector.init(db);
  providerRegistry.setSmartSelector(smartSelector);

  // Provider Group Manager
  let groupManager = new GroupManager(config.provider_groups || {});
  providerRegistry.setGroupManager(groupManager);

  // Notification Engine & DLQ Retry Scheduler
  let notificationEngine = new NotificationEngine(db, config);
  let dlqRetryScheduler = new DLQRetryScheduler(db, sendEngine, config);
  initSendLimits(db, config);

  providerRegistry.on('provider:failed', ({ provider, reason, status }) => {
    notificationEngine.providerFailed(provider, reason, status).catch(() => {});
  });
  providerRegistry.on('provider:recovered', ({ provider }) => {
    notificationEngine.providerRecovered(provider).catch(() => {});
  });

  notificationEngine.on('notification', (notification) => {
    broadcastSSE('notifications', 'notification', notification);
  });

  // SSE client management
  const sseClients = { scan: new Set(), send: new Set(), saas: new Set(), notifications: new Set() };
  function broadcastSSE(type, event, data) {
    const clients = sseClients[type];
    if (!clients) return;
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try { client.write(message); } catch (e) { clients.delete(client); }
    }
  }

  // Persistence Paths
  const campaignStatePath = path.join(dataDir, 'campaign_active.json');
  const saasStatePath = path.join(dataDir, 'saas_active.json');
  const discoveryStatePath = path.join(dataDir, 'discovery_active.json');
  const heartbeatPath = path.join(dataDir, 'send_heartbeat.json');

  // Wipe stale heartbeats on server startup
  try { if (fs.existsSync(heartbeatPath)) fs.unlinkSync(heartbeatPath); } catch {}

  function saveCampaignState(active, dryRun = false) {
    try { fs.writeFileSync(campaignStatePath, JSON.stringify({ active, dryRun, ts: new Date().toISOString() })); } catch {}
  }
  function loadCampaignState() {
    try {
      if (fs.existsSync(campaignStatePath)) return JSON.parse(fs.readFileSync(campaignStatePath, 'utf-8'));
    } catch {}
    return { active: false, dryRun: false };
  }

  function saveSaaSState(active, dryRun = false) {
    try { fs.writeFileSync(saasStatePath, JSON.stringify({ active, dryRun, ts: new Date().toISOString() })); } catch {}
  }
  function loadSaaSState() {
    try {
      if (fs.existsSync(saasStatePath)) return JSON.parse(fs.readFileSync(saasStatePath, 'utf-8'));
    } catch {}
    return { active: false, dryRun: false };
  }

  function saveDiscoveryState(active, industry = null) {
    try { fs.writeFileSync(discoveryStatePath, JSON.stringify({ active, industry, ts: new Date().toISOString() })); } catch {}
  }
  function loadDiscoveryState() {
    try {
      if (fs.existsSync(discoveryStatePath)) return JSON.parse(fs.readFileSync(discoveryStatePath, 'utf-8'));
    } catch {}
    return { active: false, industry: null };
  }

  // Wire events
  scanEngine.on('scan_progress', (data) => broadcastSSE('scan', 'scan_progress', data));
  scanEngine.on('log', (data) => {
    console.log(`[DISCOVERY] [${data.level.toUpperCase()}] ${data.message}`);
    broadcastSSE('scan', 'log', data);
  });

  sendEngine.on('send_progress', (data) => {
    broadcastSSE('send', 'send_progress', data);
    if (data.status === 'completed' || data.status === 'idle') saveCampaignState(false);
  });
  sendEngine.on('log', (data) => {
    console.log(`[SEND] [${data.level.toUpperCase()}] ${data.message}`);
    broadcastSSE('send', 'log', data);
  });

  saasEngine.on('send_progress', (data) => broadcastSSE('saas', 'send_progress', data));
  saasEngine.on('log', (data) => {
    console.log(`[SAAS] [${data.level.toUpperCase()}] ${data.message}`);
    broadcastSSE('saas', 'log', data);
  });

  notificationEngine.start();
  dlqRetryScheduler.start();

  // Auto-resume on startup (disabled during tests and when DISABLE_AUTO_RESUME is set)
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_AUTO_RESUME !== '1') {
    const savedCampaign = loadCampaignState();
    if (savedCampaign.active) {
      console.log(`[Auto-Resume] Resuming job campaign...`);
      setTimeout(() => sendEngine.start(savedCampaign.dryRun), 5000);
    }

    const savedSaaS = loadSaaSState();
    if (savedSaaS.active) {
      console.log(`[Auto-Resume] Resuming SaaS B2B Sales Engine...`);
      setTimeout(() => saasEngine.start(savedSaaS.dryRun), 15000);
    }

    const savedDiscovery = loadDiscoveryState();
    if (savedDiscovery.active) {
      console.log(`[Auto-Resume] Resuming Autonomous Discovery...`);
      setTimeout(() => scanEngine.start({ industry: savedDiscovery.industry }), 2000);
    }
  } else if (process.env.DISABLE_AUTO_RESUME === '1') {
    console.log(`[Auto-Resume] DISABLED - Engines will not auto-resume on startup.`);
  }

  // Server Heartbeat (skip during tests)
  if (process.env.NODE_ENV !== 'test') {
    setInterval(() => {
      const mem = process.memoryUsage();
      console.log(`[${new Date().toISOString()}] [Server] HEARTBEAT - Mem: ${Math.round(mem.rss / 1024 / 1024)}MB | I am alive.`);
    }, 30000);
  }

  // [OMEGA] Background Orchestration (skip during tests)
  if (process.env.NODE_ENV !== 'test') {
    setInterval(() => {
      if (config.openai_api_key && config.reply_monitor_enabled) {
        replyMonitor.start().catch(e => console.error('[OMEGA-REPLY] Error:', e.message));
      }
    }, 30 * 60 * 1000); // 30 mins

    if (config.warmup_enabled) {
      setInterval(() => {
        warmupEngine.start().catch(e => console.error('[OMEGA-WARMUP] Error:', e.message));
      }, 120 * 60 * 1000); // 2 hours
    }

    // Start first runs shortly after boot
    setTimeout(() => {
      if (config.openai_api_key && config.reply_monitor_enabled) replyMonitor.start().catch(() => {});
    }, 60000);
  }

  // Express setup
  const app = express();
  app.use(cors());
  app.use(express.json());

  // File upload for resume
  const upload = multer({
    dest: path.join(dataDir, 'uploads'),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(new Error('Only PDF files are allowed'));
    }
  });
  if (!fs.existsSync(path.join(dataDir, 'uploads'))) fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

// ============ API ROUTES ============

// Lightweight health probe — must stay fast (no DB / engine work) for watchdog heartbeats
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), pid: process.pid });
});

app.get('/api/stats', (req, res) => {
  try {
    const stats = getStats(db);
    stats.errors = scanEngine.getState().errors;
    res.json(stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Scan ---
app.get('/api/scan/status', (req, res) => res.json(scanEngine.getState()));
app.post('/api/scan/start', (req, res) => {
  const industry = req.body?.industry || null;
  scanEngine.start({ industry });
  saveDiscoveryState(true, industry);
  res.json({ success: true });
});
app.post('/api/scan/stop', (req, res) => {
  scanEngine.stop();
  saveDiscoveryState(false);
  res.json({ success: true });
});
app.get('/api/scan/stream', (req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/event-stream', 
    'Cache-Control': 'no-cache', 
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sseClients.scan.add(res);
  res.write('event: log\ndata: {"level":"info","message":"📡 SSE Connection Established","ts":"' + new Date().toISOString() + '"}\n\n');
  req.on('close', () => sseClients.scan.delete(res));
});

// --- Emails ---
app.get('/api/emails', (req, res) => {
  try {
    const { page, limit, type, search, excluded } = req.query;
    res.json(getEmails(db, {
      page: parseInt(page) || 1, limit: parseInt(limit) || 50,
      type: type || undefined, search: search || undefined,
      excluded: excluded !== undefined ? excluded === 'true' : undefined
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/emails/:id/toggle-exclude', (req, res) => {
  try { toggleExcluded(db, req.params.id); res.json({ success: true }); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Application tracker (ai-job-search inspired) ---
app.get('/api/applications', (req, res) => {
  try {
    const { page, limit, status } = req.query;
    res.json(getApplications(db, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      status: status || undefined,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/applications/:email/status', (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['applied', 'replied', 'interview', 'rejected', 'offer', 'withdrawn'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }
    updateApplicationStatus(db, req.params.email, status);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fit/stats', (req, res) => {
  try { res.json(getFitStats(db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// CSV Export — full database export
app.get('/api/emails/export', (req, res) => {
  try {
    const { type, search } = req.query;
    let where = [];
    let params = {};
    if (type) { where.push('email_type = @type'); params.type = type; }
    if (search) { where.push('(company_name LIKE @search OR email LIKE @search)'); params.search = `%${search}%`; }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const records = db.prepare(`
      SELECT er.company_name, er.email, er.email_type, er.source, er.website, er.found_date, er.excluded,
             CASE WHEN sl.email IS NOT NULL THEN 1 ELSE 0 END as sent
      FROM email_records er
      LEFT JOIN send_log sl ON er.email = sl.email
      ${whereClause}
      ORDER BY er.found_date DESC
    `).all(params);

    const header = ['company_name', 'email', 'email_type', 'source', 'website', 'found_date', 'excluded', 'sent'];
    const csv = [
      header.join(','),
      ...records.map(r => header.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="harvest-export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Campaign ---
app.post('/api/campaign/upload-resume', upload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const destPath = path.join(dataDir, 'resume.pdf');
  fs.renameSync(req.file.path, destPath);
  config.resume_path = destPath;
  saveConfig(config);
  res.json({ success: true, filename: req.file.originalname, size: req.file.size });
});

app.get('/api/campaign/status', (req, res) => {
  try {
    const state = sendEngine.getState();
    const sentCount = db.prepare('SELECT COUNT(*) as count FROM send_log').get().count;
    const remainingCount = db.prepare(`SELECT COUNT(*) as count FROM email_records WHERE excluded = 0 AND email NOT IN (SELECT email FROM send_log)`).get().count;
    res.json({ status: state.status, sent: sentCount, totalRecipients: sentCount + remainingCount, failed: state.failed, dryRun: state.dryRun });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/campaign/start', (req, res) => {
  const dryRun = req.body?.dryRun || false;
  saveCampaignState(true, dryRun);
  sendEngine.start(dryRun);
  res.json({ success: true });
});
app.post('/api/campaign/stop', (req, res) => {
  saveCampaignState(false);
  sendEngine.stop();
  res.json({ success: true });
});
app.get('/api/campaign/stream', (req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/event-stream', 
    'Cache-Control': 'no-cache', 
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sseClients.send.add(res);
  res.write('event: log\ndata: {"level":"info","message":"📡 Campaign Stream Active","ts":"' + new Date().toISOString() + '"}\n\n');
  req.on('close', () => sseClients.send.delete(res));
});

// Pixel Tracking Endpoint
app.get('/t/:id', (req, res) => {
  try {
    const idParam = req.params.id;
    let isSaaS = false;
    let b64 = idParam;
    
    if (idParam.startsWith('saas_fup_')) {
      isSaaS = true;
      b64 = idParam.replace('saas_fup_', '');
    } else if (idParam.startsWith('saas_')) {
      isSaaS = true;
      b64 = idParam.replace('saas_', '');
    } else if (idParam.startsWith('job_')) {
      isSaaS = false;
      b64 = idParam.replace('job_', '');
    } else if (idParam.endsWith('-s')) {
      isSaaS = true;
      b64 = idParam.slice(0, -2);
    }
    
    const email = Buffer.from(b64, 'base64').toString('utf8');
    const table = isSaaS ? 'send_log_saas' : 'send_log';
    const sseType = isSaaS ? 'saas' : 'send';
    const campaignTypeStr = isSaaS ? 'saas' : 'job';

    const now = new Date().toISOString();
    let query = '';
    if (isSaaS) {
      query = `UPDATE send_log_saas SET opened = COALESCE(opened, 0) + 1, last_opened_at = ? WHERE email = ?`;
      db.prepare(query).run(now, email);
    } else {
      query = `UPDATE send_log SET opened = opened + 1, opened_at = CASE WHEN opened_at IS NULL THEN ? ELSE opened_at END WHERE email = ?`;
      db.prepare(query).run(now, email);
    }
    
    // Check for Hot Lead Threshold
    const record = db.prepare(`SELECT company_name, opened as opens_count, is_hot_lead FROM ${table} WHERE email = ?`).get(email);
    const threshold = config.hot_lead_threshold || 3;
    
    if (record && record.opens_count >= threshold && record.is_hot_lead === 0) {
      db.prepare(`UPDATE ${table} SET is_hot_lead = 1 WHERE email = ?`).run(email);
      broadcastSSE(sseType, 'log', { level: 'warn', message: `🔥 HOT LEAD DETECTED: ${record.company_name} (${email})` });
      
      // Trigger Webhook if configured
      if (config.webhook_url) {
        axios.post(config.webhook_url, {
          event: 'hot_lead',
          company: record.company_name,
          email: email,
          opens: record.opens_count,
          campaign: campaignTypeStr,
          ts: new Date().toISOString()
        }).catch(err => console.error('[Webhook Error]', err.message));
      }
    }

    // Broadcast live event
    broadcastSSE(sseType, 'log', { level: 'info', message: `👁️ Mail OPENED by ${email} (${campaignTypeStr.toUpperCase()})` });
    broadcastSSE(sseType, 'mail_opened', { email, campaignType: campaignTypeStr });

    // Serve 1x1 Transparent GIF
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.send(pixel);
  } catch (e) {
    console.error('[TRACKING PIXEL ERROR]', e.message, e.stack);
    // Fail silently with pixel if something goes wrong
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.send(pixel);
  }
});

// --- SaaS Campaign ---
app.get('/api/saas/status', (req, res) => {
  const state = saasEngine.getState();
  const sentCount = db.prepare('SELECT COUNT(*) as count FROM send_log_saas').get().count;
  const remainingCount = db.prepare(`SELECT COUNT(*) as count FROM email_records WHERE excluded = 0 AND email NOT IN (SELECT email FROM send_log_saas)`).get().count;
  res.json({ ...state, sent: sentCount, totalRecipients: sentCount + remainingCount });
});

app.post('/api/saas/start', (req, res) => {
  const dryRun = req.body?.dryRun || false;
  saveSaaSState(true, dryRun);
  saasEngine.start(dryRun);
  res.json({ success: true });
});

app.post('/api/saas/stop', (req, res) => {
  saveSaaSState(false);
  saasEngine.stop();
  res.json({ success: true });
});

app.get('/api/saas/history', (req, res) => {
  try {
    const history = db.prepare('SELECT * FROM send_log_saas ORDER BY sent_at DESC LIMIT 100').all();
    res.json(history);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Replies ---
app.get('/api/replies', (req, res) => {
  try {
    const replies = db.prepare(`
      SELECT * FROM replies ORDER BY received_at DESC LIMIT 200
    `).all();
    res.json(replies);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/saas/stream', (req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/event-stream', 
    'Cache-Control': 'no-cache', 
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sseClients.saas.add(res);
  res.write('event: log\ndata: {"level":"info","message":"📡 SaaS Monitoring Active","ts":"' + new Date().toISOString() + '"}\n\n');
  req.on('close', () => sseClients.saas.delete(res));
});

// --- Settings ---
app.get('/api/settings', (req, res) => res.json(maskPassword(config)));
app.put('/api/settings', (req, res) => {
  try {
    const newConfig = { ...config, ...req.body };
    if (req.body.smtp_password === '••••••••') newConfig.smtp_password = config.smtp_password;
    
    if (req.body.smtp_pool && Array.isArray(req.body.smtp_pool)) {
      newConfig.smtp_pool = req.body.smtp_pool.map((poolItem) => {
        if (poolItem.password === '••••••••') {
          const oldPool = config.smtp_pool || [];
          const matchedItem = oldPool.find(o => o.username === poolItem.username);
          if (matchedItem) poolItem.password = matchedItem.password;
        }
        return poolItem;
      });
    }

    config = newConfig;
    saveConfig(config);
    scanEngine.config = config;
    sendEngine.config = config;
    saasEngine.config = config;
    aiAdvisor.config = config;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings/test-smtp', async (req, res) => {
  console.log('[TEST SMTP] Received request');
  try {
    const data = req.body;
    let { smtp_host, smtp_port, smtp_tls, smtp_username, smtp_password } = data;
    
    if (smtp_password === '••••••••' || !smtp_password) {
      if (data.isPoolItem && config.smtp_pool && config.smtp_pool[data.index]) {
        smtp_password = config.smtp_pool[data.index].password;
      } else if (!data.isPoolItem) {
        smtp_password = config.smtp_password;
      }
    }

    const isSecure = smtp_tls === true || String(smtp_tls).toLowerCase() === 'true';
    console.log(`[TEST SMTP] Target: ${data.isPoolItem ? 'POOL NODE #' + data.index : 'PRIMARY NODE'}`);
    console.log(`[TEST SMTP] host=${smtp_host}, port=${Number(smtp_port)}, secure=${isSecure}, user=${smtp_username}`);
    const transporter = nodemailer.createTransport({
      host: smtp_host, port: Number(smtp_port), secure: isSecure, 
      auth: { user: smtp_username, pass: smtp_password },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000
    });
    
    // Create a timeout promise to prevent hanging
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timed out after 10s')), 10000)
    );

    await Promise.race([transporter.verify(), timeoutPromise]);
    res.json({ success: true, message: 'Connection successful! Credentials are solid.' });
  } catch (e) {
    console.error(`[TEST SMTP ERROR] ${e.message}`);
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/settings/test-resend', async (req, res) => {
  try {
    let { resend_api_key } = req.body;
    // If masked, use real key from config
    if (!resend_api_key || resend_api_key === '••••••••') {
      resend_api_key = config.resend_api_key;
    }
    if (!resend_api_key) {
      return res.json({ success: false, message: 'No Resend API key configured.' });
    }
    const { Resend } = await import('resend');
    const resend = new Resend(resend_api_key.trim());
    // Fetch domains to validate the key (lightweight, no email sent)
    const { data, error } = await resend.domains.list();
    if (error) {
      return res.json({ success: false, message: `Resend error: ${error.message}` });
    }
    const domains = data?.data || [];
    const verifiedDomains = domains.filter(d => d.status === 'verified').map(d => d.name);
    res.json({
      success: true,
      message: `Resend API key is valid! Verified domains: ${verifiedDomains.length > 0 ? verifiedDomains.join(', ') : 'None yet (add & verify a domain at resend.com)'}`,
      domains
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// --- Template ---
app.get('/api/template', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '..', 'templates', 'outreach.html');
    if (fs.existsSync(templatePath)) {
      const content = fs.readFileSync(templatePath, 'utf-8');
      res.json({ content });
    } else {
      res.json({ content: getDefaultTemplate() });
    }
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'TEMPLATE_ERROR' });
  }
});

app.put('/api/template', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '..', 'templates', 'outreach.html');
    const templateDir = path.join(__dirname, '..', 'templates');
    if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(templatePath, req.body.content, 'utf-8');
    res.json({ success: true, message: 'Template saved' });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'TEMPLATE_ERROR' });
  }
});

// --- SaaS Template ---
app.get('/api/template/saas', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '..', 'templates', 'saas-pitch.html');
    if (fs.existsSync(templatePath)) {
      const content = fs.readFileSync(templatePath, 'utf-8');
      res.json({ content });
    } else {
      res.json({ content: '<h1>SaaS Template Not Found</h1>' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'TEMPLATE_ERROR' });
  }
});

app.put('/api/template/saas', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '..', 'templates', 'saas-pitch.html');
    const templateDir = path.join(__dirname, '..', 'templates');
    if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(templatePath, req.body.content, 'utf-8');
    res.json({ success: true, message: 'SaaS Template saved' });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'TEMPLATE_ERROR' });
  }
});

// ============ NOTIFICATION API ROUTES ============

app.get('/api/notifications', (req, res) => {
  try {
    const { page, limit, unreadOnly } = req.query;
    res.json(notificationEngine.getNotifications({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      unreadOnly: unreadOnly === 'true',
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications/unread-count', (req, res) => {
  try { res.json({ count: notificationEngine.getUnreadCount() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/:id/read', (req, res) => {
  try { notificationEngine.markRead(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/read-all', (req, res) => {
  try { notificationEngine.markAllRead(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sseClients.notifications.add(res);
  res.write('event: log\ndata: {"level":"info","message":"📡 Notification Stream Active","ts":"' + new Date().toISOString() + '"}\n\n');
  req.on('close', () => sseClients.notifications.delete(res));
});

// ============ ANALYTICS API ============

app.get('/api/analytics', (req, res) => {
  try {
    const period = req.query.period || '24h';
    res.json(getAnalyticsSummary(period));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics/providers', (req, res) => {
  try {
    const period = req.query.period || '24h';
    const data = getAnalyticsSummary(period);
    res.json(data.byProvider);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics/actions', (req, res) => {
  try {
    const period = req.query.period || '24h';
    const data = getAnalyticsSummary(period);
    res.json(data.byAction);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ SMART SELECTOR API ============

app.get('/api/selector/scores', (req, res) => {
  try {
    res.json(smartSelector.getScores());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ PROVIDER GROUPS API ============

app.get('/api/provider-groups', (req, res) => {
  try {
    res.json(providerRegistry.getAllGroupStatuses());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/provider-groups/:name/reset', (req, res) => {
  try {
    groupManager.resetGroup(req.params.name);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ DLQ MANAGEMENT API ============

app.get('/api/dlq/items', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { status: filterStatus, queue: filterQueue, search, sortBy, sortDir } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    if (filterStatus) {
      if (filterStatus === 'exhausted') { where += ' AND retry_count >= max_retries'; }
      else if (filterStatus === 'pending') { where += ' AND retry_count < max_retries'; }
      else { where += ' AND status = ?'; params.push(filterStatus); }
    }
    if (filterQueue) { where += ' AND queue_name = ?'; params.push(filterQueue); }
    if (search) { where += ' AND (item_data LIKE ? OR error_message LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const allowedSorts = ['id', 'queue_name', 'retry_count', 'failed_at', 'created_at'];
    const orderCol = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
    const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

    const total = db.prepare(`SELECT COUNT(*) as count FROM dead_letter_queue ${where}`).get(...params).count;
    const items = db.prepare(`SELECT * FROM dead_letter_queue ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dlq/retry-batch', async (req, res) => {
  try {
    const { ids, limit: batchLimit } = req.body;
    if (ids && !Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });

    let items;
    if (ids && ids.length > 0) {
      items = db.prepare(`SELECT * FROM dead_letter_queue WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    } else {
      items = db.prepare('SELECT * FROM dead_letter_queue WHERE retry_count < ? ORDER BY created_at ASC LIMIT ?').all(dlqRetryScheduler.maxRetries, batchLimit || 10);
    }

    let retried = 0;
    if (items.length > 0) {
      retried = await dlqRetryScheduler.retryItems(items);
    }

    res.json({ success: true, retried, total: items.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dlq/clear-failed', (req, res) => {
  try {
    const { ids, olderThanDays } = req.body;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      const info = db.prepare(`DELETE FROM dead_letter_queue WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      return res.json({ success: true, deleted: info.changes });
    }

    let where = 'WHERE retry_count >= max_retries';
    const params = [];
    if (olderThanDays) {
      where += ' AND created_at < datetime(\'now\', ?)';
      params.push(`-${olderThanDays} days`);
    }

    const info = db.prepare(`DELETE FROM dead_letter_queue ${where}`).run(...params);
    res.json({ success: true, deleted: info.changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dlq/archive', (req, res) => {
  try {
    const { olderThanDays } = req.body;
    let rows;
    if (olderThanDays) {
      rows = db.prepare('SELECT * FROM dead_letter_queue WHERE created_at < datetime(\'now\', ?) ORDER BY created_at').all(`-${olderThanDays} days`);
    } else {
      rows = db.prepare('SELECT * FROM dead_letter_queue WHERE retry_count >= max_retries ORDER BY created_at').all();
    }

    if (rows.length === 0) return res.json({ success: true, archived: 0, message: 'No items to archive' });

    const csv = stringify(rows, { header: true });
    const archiveDir = path.join(dataDir, 'archives');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const filename = `dlq-archive-${new Date().toISOString().slice(0, 10)}.csv`;
    fs.writeFileSync(path.join(archiveDir, filename), csv, 'utf-8');

    // Remove archived items
    const ids = rows.map(r => r.id);
    db.prepare(`DELETE FROM dead_letter_queue WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

    res.json({ success: true, archived: rows.length, file: filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ DLQ ITEM API ============

app.get('/api/dlq/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dlq/items/:id/retry', async (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const count = await dlqRetryScheduler.retryItems([item]);
    res.json({ success: true, retried: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dlq/items/:id/reset', (req, res) => {
  try {
    db.prepare('UPDATE dead_letter_queue SET retry_count = 0, status = \'pending\' WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dlq/items/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ DLQ ERROR DISTRIBUTION ============

app.get('/api/dlq/errors', (req, res) => {
  try {
    const distribution = db.prepare(`
      SELECT
        CASE
          WHEN error_message LIKE '%429%' OR error_message LIKE '%rate limit%' OR error_message LIKE '%quota%' THEN 'rate_limit'
          WHEN error_message LIKE '%402%' OR error_message LIKE '%billing%' OR error_message LIKE '%payment%' THEN 'billing'
          WHEN error_message LIKE '%401%' OR error_message LIKE '%unauthorized%' OR error_message LIKE '%auth%' OR error_message LIKE '%key%' THEN 'auth'
          WHEN error_message LIKE '%timeout%' OR error_message LIKE '%timed out%' OR error_message LIKE '%ETIMEDOUT%' THEN 'timeout'
          WHEN error_message LIKE '%spam%' OR error_message LIKE '%blocked%' OR error_message LIKE '%bounce%' OR error_message LIKE '%reject%' THEN 'blocked'
          ELSE 'other'
        END as error_type,
        COUNT(*) as count
      FROM dead_letter_queue
      WHERE retry_count < max_retries
      GROUP BY error_type
      ORDER BY count DESC
    `).all();

    const total = distribution.reduce((s, r) => s + r.count, 0);
    const byQueue = db.prepare(`
      SELECT queue_name, COUNT(*) as count FROM dead_letter_queue GROUP BY queue_name
    `).all();

    res.json({ distribution, total, byQueue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ PROVIDER STATUS API ============

app.get('/api/provider-status', (req, res) => {
  try {
    const providers = {};
    for (const name of ['scraperapi', 'scrapingbee', 'zenrows', 'resend', 'reoon', 'mailboxvalidator', 'gemini', 'openai']) {
      providers[name] = providerRegistry.getStatus(name);
    }
    res.json({ providers, dlq: dlqRetryScheduler.getStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

  // Frontend Catch-all
  const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  return { app, db, scanEngine, sendEngine, saasEngine, aiAdvisor, replyMonitor, warmupEngine, notificationEngine, dlqRetryScheduler, smartSelector, groupManager, getDefaultTemplate };
}

export function startServer({ port = PORT, host = '0.0.0.0' } = {}) {
  const { app } = createApp();
  const server = app.listen(port, host, () => {
    console.log(`[${new Date().toISOString()}] [Server] 🍁 Canada Outreach Engine: OMEGA Active on port ${port}`);
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[${new Date().toISOString()}] [FATAL-SERVER] Port ${port} is already in use. Please stop the process using this port or change the PORT environment variable.`);
      process.exit(1);
    } else {
      console.error(`[${new Date().toISOString()}] [FATAL-SERVER] Server error:`, err.message);
      process.exit(1);
    }
  });
  
  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

function getDefaultTemplate() {
  return `<h2 style="color:#0f172a;">Dear Hiring Manager at {{company_name}},</h2>
<p>I am reaching out to express my strong interest in contributing to your team. With 14+ years of enterprise IT experience, I bring hands-on expertise in Microsoft 365, Azure AD/Entra ID, Windows Server, VMware/Hyper-V, and PowerShell automation.</p>
{{personalized_intro}}
<p>At KPMG, I inherited ~200 unresolved tickets for 2,500+ users and resolved 100% of them. At INTELLICA, I was the sole IT resource managing 500 users, 100+ Linux servers, and led a full Google Workspace → Microsoft 365 migration with zero data loss.</p>
<p>I am based in Toronto, ON and authorized to work in Canada (OWP). I look forward to discussing how my skills could benefit {{company_name}}.</p>
<p>Best regards,<br><strong>Semih K&#305;l&#305;&#231;</strong><br>semihkilic@semihkilic.com | 437-777-8747</p>`;
}
