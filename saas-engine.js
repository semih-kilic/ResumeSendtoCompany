import axios from 'axios';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { getUnsentSaaS, insertSaaSLog, getSaaSFollowupCandidates, markSaaSFollowupSent } from './db.js';
import { PdfEngine } from './pdf-engine.js';
import { discoverSaaSLeads } from './saas-lead-finder.js';
import { ResendProvider } from './resend-provider.js';
import { normalizeEmail, isValidEmailForSend } from './email-utils.js';
import { canSendToDomain, checkDailyAccountCap, isBounced, recordBounce } from './send-limits.js';

// Resend SDK (loaded lazily so the system still boots if key is absent)
let ResendClient = null;
async function getResendClient(apiKey) {
  if (!apiKey) return null;
  if (!ResendClient) {
    const { Resend } = await import('resend');
    ResendClient = Resend;
  }
  return new ResendClient(apiKey);
}

export class SaaSEngine extends EventEmitter {
  constructor(db, config, aiAdvisor = null) {
    super();
    this.db = db;
    this.config = config;
    this.aiAdvisor = aiAdvisor;
    this.state = {
      status: 'idle',
      totalRecipients: 0,
      sent: 0,
      failed: 0,
      dryRun: false,
      activeProvider: 'resend'
    };
    this.paused = false;
    this.stopped = false;
    this.consecutiveSpamErrors = 0;
    this.SPAM_PAUSE_THRESHOLD = 5;
    this.currentSmtpIndex = -1; // -1 = primary, 0+ = pool index
    this._smtpExhaustedAt = null;
    this.resendProvider = new ResendProvider(config, (level, msg) => this._log(level, msg));
    this._smtpIndex = 0;
    this._saasSmtpIndex = 0;
  }

  getState() { return { ...this.state }; }

  async start(dryRun = false) {
    if (this.state.status === 'running') return;

    const sentInDb = this.db.prepare('SELECT COUNT(*) as count FROM send_log_saas').get().count;
    const remainingCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM email_records 
      WHERE excluded = 0 AND email NOT IN (SELECT email FROM send_log_saas)
    `).get().count;

    this.state.status = 'running';
    this.state.dryRun = dryRun;
    this.state.sent = sentInDb;
    this.state.total = sentInDb + remainingCount;
    this.state.failed = 0;
    this.paused = false;
    this.stopped = false;

    this._log('info', `Send campaign started${dryRun ? ' (DRY RUN)' : ''}`);
    this._emitProgress();

    try {
      await this._runSendPipeline(dryRun);
      this.state.status = 'completed';
      this._log('info', `Campaign completed. ${this.state.sent} sent, ${this.state.failed} failed.`);
    } catch (e) {
      this.state.status = 'idle';
      this._log('error', `Campaign error: ${e.message}`);
    }

    this._emitProgress();
  }

  pause() {
    this.paused = true;
    this.state.status = 'paused';
    this._log('info', 'Campaign paused');
    this._emitProgress();
  }

  stop() {
    this.stopped = true;
    this.state.status = 'idle';
    this._log('info', 'Campaign stopped');
    this._emitProgress();
  }

  // ─────────────────────────────────────────────────────────────────
  // Core pipeline
  // ─────────────────────────────────────────────────────────────────
  async _runSendPipeline(dryRun) {
    const engineRootDir = process.cwd().endsWith('backend')
      ? path.join(process.cwd(), '..')
      : process.cwd();
    const heartbeatPath = path.join(engineRootDir, 'backend', 'data', 'send_heartbeat.json');
    try { if (fs.existsSync(heartbeatPath)) fs.unlinkSync(heartbeatPath); } catch {}

    const updateHeartbeat = () => {
      try { fs.writeFileSync(heartbeatPath, JSON.stringify({ ts: Date.now() })); } catch {}
    };

    // Determine active sending provider
    const resendApiKey = this.config.resend_api_key?.trim();
    const useResend = !!resendApiKey && this.resendProvider.isAvailable();
    this.state.activeProvider = useResend ? 'resend' : 'smtp';
    this._log('info', `📬 Active sending provider: ${this.state.activeProvider.toUpperCase()}`);

    let resend = null;
    let transporter = null;
    const pool = (this.config.saas_smtp_pool && this.config.saas_smtp_pool.length > 0)
      ? this.config.saas_smtp_pool
      : this.config.smtp_pool;

    if (!dryRun) {
      if (useResend) {
        resend = await getResendClient(resendApiKey);
      } else {
        transporter = this._createTransporter();
      }
    }

    let round = 1;
    while (!this.stopped) {
      this.state.lastPulse = new Date().toISOString();

      // ─────────────────────────────────────────────────────────────────
      // Part 0: [V3] SaaS Lead Discovery (Google/DuckDuckGo Hunter)
      // ─────────────────────────────────────────────────────────────────
      try {
        this._log('info', '🔎 [SAAS-HUNTER] Running CyberSec Pro lead discovery...');
        const discoveryResult = await discoverSaaSLeads({
          db: this.db,
          config: this.config,
          logger: (msg) => this._log('info', msg),
          maxQueries: 100
        });
        if (discoveryResult.verified > 0) {
          this._log('info', `🎯 [SAAS-HUNTER] Found ${discoveryResult.verified} new verified leads!`);
        }
      } catch (err) {
        this._log('warn', `[SAAS-HUNTER] Discovery error: ${err.message}`);
      }

      // ─────────────────────────────────────────────────────────────────
      // Part A: Enrichment Pass (Find LinkedIn profiles for leads)
      // ─────────────────────────────────────────────────────────────────
      await this._runEnrichmentPass();

      // ─────────────────────────────────────────────────────────────────
      // Part B: Follow-up Pass (Run this every round, even if no new leads)
      // ─────────────────────────────────────────────────────────────────
      const followUpTransporter = this._createTransporter();
      const followUpResend = this.config.resend_api_key ? await getResendClient(this.config.resend_api_key) : null;
      await this._runFollowupPass(engineRootDir, followUpTransporter, followUpResend);

      const unsent = getUnsentSaaS(this.db);
      this.state.totalRecipients = this.state.sent + this.state.failed + unsent.length;
      this._emitProgress();

      if (unsent.length === 0) {
        this._log('info', '📭 [AUTONOMOUS] No more unsent emails. Waiting 5 minutes for new discoveries...');
        // Wait 5 minutes before checking again, unless stopped
        for (let i = 0; i < 60; i++) {
          if (this.stopped) break;
          updateHeartbeat();
          await new Promise(r => setTimeout(r, 5000));
        }
        continue; // Check again
      }

      this._log('info', `🚀 [AUTONOMOUS] [ROUND ${round}] Processing ${unsent.length} initial targets.`);

      // Load template
      const templatePath = path.join(engineRootDir, 'templates', 'saas-pitch.html');
      let template = '<p>Dear Hiring Manager at {{company_name}},</p><p>Interested in my application...</p>';
      try {
        template = fs.readFileSync(templatePath, 'utf-8');
      } catch {
        this._log('warn', 'Using default template (outreach.html not found)');
      }

      let currentDelay = (this.config.send_delay_secs || 72) * 1000;
      const MIN_DELAY = 30 * 1000;
      const MAX_DELAY = 120 * 1000;

      for (const record of unsent) {
        if (this.stopped) break;
        updateHeartbeat();

        this._log('info', `[CYCLE] [R${round}] Processing ${record.email}`);

        while (this.paused) {
          this._log('debug', 'Still paused, waiting...');
          updateHeartbeat();
          await new Promise(r => setTimeout(r, 5000));
          if (this.stopped) break;
        }
        if (this.stopped) break;

        try {
          record.email = normalizeEmail(record.email) || record.email;

          if (!isValidEmailForSend(record.email)) {
            this._log('warn', `[VALIDATE] Skipping invalid email: ${record.email}`);
            this.db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(record.id);
            this.state.failed++;
            this._emitProgress();
            continue;
          }

          if (!record.ai_intro && record.website && this.config.ai_personalization_enabled) {
            try {
              this._log('info', `[AI-ADVISOR] Reading website for ${record.company_name}...`);
              const { data: html } = await axios.get(record.website, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }, maxContentLength: 100000 });
              const truncatedHtml = typeof html === 'string' ? html.substring(0, 30000) : '';
              const intro = await this.aiAdvisor.generateIntro(record.company_name, truncatedHtml);
              if (intro) {
                record.ai_intro = intro;
                this.db.prepare('UPDATE email_records SET ai_intro = ? WHERE email = ?').run(intro, record.email);
                this._log('info', `[AI-ADVISOR] Intro generated successfully!`);
              }
            } catch (e) {
              this._log('warn', `[AI-ADVISOR] Could not read website/generate intro: ${e.message}`);
            }
          }

          const personalizedIntro = record.ai_intro ? `<p style="color:#2c5282;font-style:italic;margin-bottom:20px;">${record.ai_intro}</p>` : '';
          let htmlBody = template
            .replace(/\{\{company_name\}\}/g, record.company_name)
            .replace(/\{\{personalized_intro\}\}/g, personalizedIntro);
          
          // --- Inject Tracking Pixel ---
          if (this.config.tracking_base_url) {
            const trackId = `saas_${Buffer.from(record.email).toString('base64')}`;
            const pixelUrl = `${this.config.tracking_base_url.replace(/\/$/, '')}/t/${trackId}`;
            htmlBody += `<img src="${pixelUrl}" width="1" height="1" style="display:none !important;" alt="" />`;
          }

          const subject = (this.config.saas_email_subject || "Optimizing IT Infrastructure for {{company_name}}")
            .replace(/\{\{company_name\}\}/g, record.company_name);

          const plainText = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

          // --- Anti-blacklist: bounce check + domain throttling ---
          if (isBounced(record.email)) {
            this._log('warn', `[BOUNCE-GUARD] Skipping ${record.email} — previously bounced`);
            this.db.prepare('UPDATE email_records_saas SET excluded = 1 WHERE email = ?').run(record.email);
            this.state.failed++;
            this._emitProgress();
            continue;
          }

          const domain = record.email.split('@')[1];
          if (domain) {
            const domainCheck = canSendToDomain(domain, 'saas');
            if (!domainCheck.allowed) {
              this._log('warn', `[DOMAIN-THROTTLE] ${domain}: ${domainCheck.reason}. Delaying...`);
              await new Promise(r => setTimeout(r, domainCheck.reason.includes('minute') ? 12000 : 300000));
            }
            const accountCheck = checkDailyAccountCap(this._getActiveEmail(), 'saas');
            if (!accountCheck.allowed) {
              this._log('warn', `[ACCOUNT-CAP] ${accountCheck.reason}. Delaying 5 minutes...`);
              await new Promise(r => setTimeout(r, 300000));
            }
          }

          if (dryRun) {
            this._log('info', `[DRY RUN] Target: ${record.email}`);
          } else {
            // ── Try Resend first ──────────────────────────────────
            if (resend && this.resendProvider.isAvailable()) {
              // No attachments for SaaS to improve deliverability
              const sent = await this._sendViaResend(resend, record, htmlBody, plainText, [], subject);
              if (sent === 'ok') {
                currentDelay = Math.max(MIN_DELAY, currentDelay - 2000);
                this._emitProgress();
                updateHeartbeat();
                if (!dryRun) {
                  this._log('info', `[THROTTLE] Waiting ${currentDelay / 1000}s...`);
                  await new Promise(r => setTimeout(r, currentDelay));
                }
                continue;
              } else if (sent === 'cooldown') {
                this.state.activeProvider = 'smtp';
                if (!transporter) transporter = this._createTransporter();
              }
              // sent === 'retry' → fall through to SMTP for this email
            }

            // ── SMTP path ─────────────────────────────────────────
            if (!transporter) transporter = this._createTransporter();
            try {
              await Promise.race([
                transporter.verify(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP Verify Timeout')), 15000))
              ]);
            } catch (verifyErr) {
              this._log('warn', `[SMTP] Connection check failed (${verifyErr.message}). Rotating...`);
              this._rotateSmtp();
              transporter = this._createTransporter();
            }

            const activePool = (this.config.saas_smtp_pool && this.config.saas_smtp_pool.length > 0)
              ? this.config.saas_smtp_pool
              : (this.config.smtp_pool || []);

            const activePoolItem = (this.currentSmtpIndex >= 0 && activePool[this.currentSmtpIndex]);
            const activeUser = activePoolItem ? activePoolItem.username : (this.config.saas_from_email || this.config.smtp_from_email);
            const activeFromEmail = activePoolItem
              ? (activePoolItem.from_email || activePoolItem.username)
              : (this.config.saas_from_email || this.config.smtp_from_email || activeUser);
            
            const fromName = this.config.saas_from_name || this.config.smtp_from_name;

            const mailOptions = {
              from: `"${fromName}" <${activeFromEmail}>`,
              to: record.email,
              subject: subject,
              html: htmlBody,
              text: plainText,
              // No attachments for SaaS
            };

            await Promise.race([
              transporter.sendMail(mailOptions),
              new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP Send Timeout')), 45000))
            ]);
            this._log('info', `✅ [SAAS SENT via SMTP] [R${round}] ${record.email}`);
            
            // [V3] ROUND-ROBIN SMTP: Force rotation after every successful send to distribute load
            const pool = this.config.saas_smtp_pool || this.config.smtp_pool;
            if (pool && pool.length > 1) {
              this._rotateSmtp();
              transporter = this._createTransporter();
            }
          }

          insertSaaSLog(this.db, record.email, record.company_name, record.linkedin_url);
          this.state.sent++;
          this.consecutiveSpamErrors = 0;
          currentDelay = Math.max(MIN_DELAY, currentDelay - 2000);

        } catch (e) {
          currentDelay = Math.min(MAX_DELAY, currentDelay + 15000);
          this.state.failed++;
          this._log('error', `❌ [FAILED] Error for ${record.email}: ${e.message}`);

          const errMsg = e.message.toLowerCase();

          // Sender-side errors — rotate SMTP
          const isSenderError = errMsg.includes('550-5.4.5') || errMsg.includes('limit') ||
                                errMsg.includes('quota') || errMsg.includes('spam') ||
                                errMsg.includes('blocked') || errMsg.includes('auth') ||
                                errMsg.includes('refused') || (errMsg.includes('550') && errMsg.includes('sending'));

          if (isSenderError) {
            this.consecutiveSpamErrors++;
            this._log('error', `[RATE-LIMIT] Quota or sender block on current node. Rotating SMTP pool...`);
            const rotated = this._rotateSmtp();
            if (!rotated) {
              const resumed = await this._waitForSmtpPoolReset(updateHeartbeat);
              if (resumed) {
                transporter = this._createTransporter();
                this._log('info', `[RETRY] Attempting to resend to ${record.email} after SMTP pool reset...`);
                continue;
              }
              this._log('error', '[HALT] SMTP pool still exhausted after cooldown wait.');
              this.pause();
              break;
            } else {
              transporter = this._createTransporter();
              this.consecutiveSpamErrors = 0;
              // Re-try the same record with the new transporter
              this._log('info', `[RETRY] Attempting to resend to ${record.email} with new SMTP node...`);
              continue; 
            }
          }

          // Definitive bounce — blacklist domain
          if (errMsg.includes('mailbox') || errMsg.includes('user unknown') ||
              errMsg.includes('not found') || errMsg.includes('no such user') ||
              errMsg.includes('unroutable') || (errMsg.includes('invalid') && !errMsg.includes('credentials')) ||
              errMsg.includes('does not exist') || errMsg.includes('unknown') ||
              errMsg.includes('550 5.1.1')) {
              this._log('warn', `[BOUNCE] ${record.email} is dead. Excluding and penalizing domain.`);
            try {
              recordBounce(record.email, 'hard', 'saas');
              this.db.prepare('UPDATE email_records_saas SET excluded = 1 WHERE email = ?').run(record.email);
              const domain = record.email.split('@')[1];
              const { updateDomainTrust } = await import('./verifier.js');
              updateDomainTrust(domain, -1.0);
            } catch {}
            continue;
          }
        }

        this._emitProgress();
        updateHeartbeat();

        if (!dryRun) {
          this._log('info', `[THROTTLE] Waiting ${currentDelay / 1000}s...`);
          await new Promise(r => setTimeout(r, currentDelay));
        }
      }

      round++;
      this._log('info', `🏁 [ROUND ${round - 1}] Complete. Sleeping for 1 hour...`);
      for (let i = 0; i < 120; i++) {
        if (this.stopped) break;
        updateHeartbeat();
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }

  async _runFollowupPass(engineRootDir, transporter, resend) {
    const delayDays = this.config.saas_followup_days || 3;
    const candidates = getSaaSFollowupCandidates(this.db, delayDays);
    if (candidates.length === 0) return;

    this._log('info', `🔁 [FOLLOW-UP] Checking ${candidates.length} potential candidates...`);
    
    const templatePath = path.join(engineRootDir, 'templates', 'saas-followup.html');
    if (!fs.existsSync(templatePath)) {
      this._log('error', `[FOLLOW-UP] Template missing: ${templatePath}`);
      return;
    }
    const template = fs.readFileSync(templatePath, 'utf8');

    for (const record of candidates) {
      if (this.stopped) break;
      try {
        let htmlBody = template.replace(/\{\{company_name\}\}/g, record.company_name);
        
        // Inject Tracking Pixel
        if (this.config.tracking_base_url) {
          const trackId = `saas_fup_${Buffer.from(record.email).toString('base64')}`;
          const pixelUrl = `${this.config.tracking_base_url.replace(/\/$/, '')}/t/${trackId}`;
          htmlBody += `<img src="${pixelUrl}" width="1" height="1" style="display:none !important;" alt="" />`;
        }

        const subject = `Re: Optimizing IT Infrastructure for ${record.company_name}`;
        const plainText = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

        const activePool = (this.config.saas_smtp_pool && this.config.saas_smtp_pool.length > 0)
          ? this.config.saas_smtp_pool
          : (this.config.smtp_pool || []);
        const activePoolItem = (this.currentSmtpIndex >= 0 && activePool[this.currentSmtpIndex]);
        const activeUser = activePoolItem ? activePoolItem.username : (this.config.saas_from_email || this.config.smtp_from_email);
        const activeFromEmail = (activePoolItem && activePoolItem.from_email)
          ? activePoolItem.from_email
          : (this.config.saas_from_email || this.config.smtp_from_email || activeUser);
        
        const fromName = this.config.saas_from_name || this.config.smtp_from_name;

        const mailOptions = {
          from: `"${fromName}" <${activeFromEmail}>`,
          to: record.email,
          subject: subject,
          html: htmlBody,
          text: plainText
        };

        if (this.state.activeProvider === 'resend' && resend) {
          await resend.emails.send({
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject,
            html: mailOptions.html
          });
        } else {
          await transporter.sendMail(mailOptions);
        }

        this._log('info', `✅ [FOLLOW-UP SENT] ${record.email}`);
        markSaaSFollowupSent(this.db, record.email);
        
        // Anti-spam delay
        await new Promise(r => setTimeout(r, 15000));
      } catch (err) {
        this._log('error', `[FOLLOW-UP FAILED] ${record.email}: ${err.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Resend sender
  // Returns: 'ok' | 'retry' | 'disabled'
  // ─────────────────────────────────────────────────────────────────
  async _sendViaResend(resend, record, htmlBody, plainText, attachments, subject) {
    try {
      const { from, replyTo } = this.resendProvider.getFromAddress('saas');
      const payload = {
        from,
        reply_to: replyTo,
        to: [record.email],
        subject: subject,
        html: htmlBody,
        text: plainText,
      };

      if (attachments && attachments.resend && attachments.resend.length > 0) {
        payload.attachments = attachments.resend;
      } else if (Array.isArray(attachments) && attachments.length > 0) {
        payload.attachments = attachments;
      }

      const { error } = await resend.emails.send(payload);
      return this.resendProvider.classifyError(error);
    } catch (err) {
      this._log('warn', `[Resend] Exception: ${err.message}`);
      return 'retry';
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Build PDF attachments (shared between Resend and SMTP)
  // Returns { smtp: [...nodemailer format], resend: [...resend format] }
  // ─────────────────────────────────────────────────────────────────
  async _buildAttachments(engineRootDir, companyName) {
    const smtp = [];
    const resend = [];
    let usedDynamicPdf = false;

    try {
      const profilePath = path.join(engineRootDir, 'backend', 'config', 'cv-profile.json');
      if (fs.existsSync(profilePath)) {
        if (!this.pdfEngine) this.pdfEngine = new PdfEngine();
        const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        profileData.SUMMARY_TEXT = profileData.SUMMARY_TEXT.replace(
          'actively seeking opportunities',
          `actively seeking opportunities at ${companyName}`
        );
        const pdfBuffer = await this.pdfEngine.generatePdfBuffer(profileData);
        const filename = `Resume_${this.config.smtp_from_name.replace(/\s+/g, '_')}.pdf`;

        smtp.push({ filename, content: pdfBuffer, contentType: 'application/pdf' });
        resend.push({ filename, content: pdfBuffer.toString('base64') });
        usedDynamicPdf = true;
      }
    } catch (err) {
      this._log('warn', `Dynamic PDF generation failed: ${err.message}. Falling back to static resume.`);
    }

    if (!usedDynamicPdf && this.config.resume_path && fs.existsSync(this.config.resume_path)) {
      const filename = path.basename(this.config.resume_path);
      const pdfBuffer = fs.readFileSync(this.config.resume_path);
      smtp.push({ filename, path: this.config.resume_path, contentType: 'application/pdf' });
      resend.push({ filename, content: pdfBuffer.toString('base64') });
    }

    return { smtp, resend };
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────
  _emitProgress() {
    this.emit('send_progress', {
      sent: this.state.sent,
      total: this.state.totalRecipients,
      failed: this.state.failed,
      status: this.state.status,
      dry_run: this.state.dryRun,
      active_provider: this.state.activeProvider
    });
  }

  _createTransporter() {
    // Priority: saas_smtp_pool > main pool > primary
    const pool = (this.config.saas_smtp_pool && this.config.saas_smtp_pool.length > 0)
      ? this.config.saas_smtp_pool
      : this.config.smtp_pool;

    let host = this.config.smtp_host;
    let port = this.config.smtp_port;
    let secure = this.config.smtp_tls;
    let user = this.config.smtp_username;
    let pass = this.config.smtp_password;

    if (this.currentSmtpIndex >= 0 && pool && this.currentSmtpIndex < pool.length) {
      const poolCfg = pool[this.currentSmtpIndex];
      host = poolCfg.host;
      port = poolCfg.port;
      secure = poolCfg.tls;
      user = poolCfg.username;
      pass = poolCfg.password;
    }

    // Robust port handling: 465 is implicit SSL/TLS, 587 is STARTTLS
    const isPort465 = parseInt(port) === 465;
    
    return nodemailer.createTransport({
      host,
      port,
      secure: isPort465, // true for 465, false for 587
      auth: { user, pass },
      tls: {
        // Do not fail on invalid certs, common with some private SMTPs
        rejectUnauthorized: false 
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      debug: false,
      logger: false
    });
  }

  _rotateSmtp() {
    const pool = (this.config.saas_smtp_pool && this.config.saas_smtp_pool.length > 0)
      ? this.config.saas_smtp_pool
      : (this.config.smtp_pool || []);
      
    const poolSize = pool.length;
    if (poolSize === 0 && this.currentSmtpIndex === -1) {
      this._log('error', 'No alternative SMTP providers mapped in Settings to rotate to!');
      return false;
    }
    this.currentSmtpIndex++;
    if (this.currentSmtpIndex >= poolSize) {
      this._log('warn', 'All backup SMTP providers exhausted! Waiting for quota cooldown.');
      this._smtpExhaustedAt = Date.now();
      this.currentSmtpIndex = -1;
      return false;
    }
    const poolCfg = pool[this.currentSmtpIndex];
    this._log('info', `Rotating to SaaS SMTP pool provider #${this.currentSmtpIndex + 1} (${poolCfg.host} - ${poolCfg.username})`);
    return true;
  }

  async _waitForSmtpPoolReset(updateHeartbeat) {
    if (!this._smtpExhaustedAt) return true;

    const cooldownMs = (this.config.smtp_pool_cooldown_mins || 60) * 60 * 1000;
    const remaining = cooldownMs - (Date.now() - this._smtpExhaustedAt);

    if (remaining <= 0) {
      this._smtpExhaustedAt = null;
      this.currentSmtpIndex = -1;
      this._log('info', '[SMTP] Pool cooldown expired — resetting rotation.');
      return true;
    }

    this._log('info', `[SMTP] Waiting ${Math.ceil(remaining / 60000)} min for SMTP pool quota reset...`);
    const stepMs = 30000;
    let waited = 0;
    while (waited < remaining) {
      if (this.stopped) return false;
      updateHeartbeat?.();
      await new Promise((r) => setTimeout(r, Math.min(stepMs, remaining - waited)));
      waited += stepMs;
    }

    this._smtpExhaustedAt = null;
    this.currentSmtpIndex = -1;
    this._log('info', '[SMTP] Pool cooldown complete — resuming SaaS sends.');
    return true;
  }

  _getActiveEmail() {
    const pool = (this.config.saas_smtp_pool && this.config.saas_smtp_pool.length > 0)
      ? this.config.saas_smtp_pool
      : (this.config.smtp_pool || []);
    if (this.currentSmtpIndex >= 0 && pool[this.currentSmtpIndex]) {
      return pool[this.currentSmtpIndex].username || pool[this.currentSmtpIndex].from_email || this.config.saas_from_email || this.config.smtp_from_email;
    }
    return this.config.saas_from_email || this.config.smtp_from_email || '';
  }

  async _runEnrichmentPass() {
    this._log('info', '🔍 [ENRICHMENT] Checking for missing LinkedIn profiles...');
    
    // Get leads from email_records that are NOT in send_log_saas yet (unsent)
    // and have no linkedin_url in our system.
    const candidates = this.db.prepare(`
      SELECT DISTINCT company_name, website FROM email_records 
      WHERE (linkedin_url IS NULL OR linkedin_url = '')
      AND excluded = 0
      LIMIT 10
    `).all();

    if (candidates.length === 0) return;

    if (!this.scraper) {
      const { WebScraper, RateLimiter, UserAgentRotator } = await import('./scraper.js');
      const rl = new RateLimiter(this.config.domain_delay_ms || 1000);
      const uar = new UserAgentRotator(this.config.user_agents || []);
      this.scraper = new WebScraper(this.config, rl, uar, this);
    }

    for (const lead of candidates) {
      if (this.stopped) break;
      this._log('info', `🔎 [ENRICHMENT] Searching LinkedIn for: ${lead.company_name}`);
      
      const linkedinUrl = await this.scraper.findLinkedInProfile(lead.company_name, null, lead.website);
      
      if (linkedinUrl) {
        this._log('info', `✅ [ENRICHMENT] Found: ${linkedinUrl}`);
        this.db.prepare('UPDATE email_records SET linkedin_url = ? WHERE company_name = ?').run(linkedinUrl, lead.company_name);
        // Also update send_log_saas if it exists there
        this.db.prepare('UPDATE send_log_saas SET linkedin_url = ? WHERE company_name = ?').run(linkedinUrl, lead.company_name);
      } else {
        this._log('warn', `❌ [ENRICHMENT] No profile found for ${lead.company_name}`);
        // Mark as tried to avoid infinite loops?
        this.db.prepare("UPDATE email_records SET linkedin_url = 'N/A' WHERE company_name = ? AND (linkedin_url IS NULL OR linkedin_url = '')").run(lead.company_name);
      }

      // Small delay between searches to be safe
      await new Promise(r => setTimeout(r, (this.config.linkedin_delay_secs || 5) * 1000));
    }
  }

  _log(level, message) {
    this.emit('log', { level, message, ts: new Date().toISOString() });
  }
}
