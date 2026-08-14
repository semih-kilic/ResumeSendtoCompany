import nodemailer from 'nodemailer';
import OpenAI from 'openai';

const WARMUP_SCHEDULE = [
  5, 5, 10, 10, 15, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80,
];

export class WarmupEngine {
  constructor(config, db = null) {
    this.config = config;
    this.db = db;
    this.openai = config.openai_api_key ? new OpenAI({ apiKey: config.openai_api_key }) : null;
    this._timer = null;
    this._active = false;
  }

  async start() {
    if (this._active) return;
    this._active = true;
    this._ensureWarmupAccounts();
    await this._runCycle();
    const interval = (this.config.warmup?.interval_mins || 15) * 60 * 1000;
    this._timer = setInterval(() => this._runCycle(), interval);
    console.info(`[WARMUP] Engine started (cycle interval: ${interval / 1000}s)`);
  }

  stop() {
    this._active = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.info('[WARMUP] Engine stopped');
  }

  _ensureWarmupAccounts() {
    if (!this.db) return;
    const pool = this._getPool();
    for (const account of pool) {
      const exists = this.db.prepare('SELECT id FROM warmup_state WHERE account_email = ?').get(account.email);
      if (!exists) {
        this.db.prepare('INSERT OR IGNORE INTO warmup_state (account_email, warmup_group, day, max_daily) VALUES (?, ?, 0, ?)').run(account.email, 'main', WARMUP_SCHEDULE[0]);
      }
    }
  }

  async _runCycle() {
    if (!this._active) return;
    const pool = this._getPool();
    if (pool.length < 2) return;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    for (let i = 0; i < pool.length; i++) {
      const sender = pool[i];
      const receiver = pool[(i + 1) % pool.length];

      try {
        if (this._isExcluded(receiver.email) || this._isExcluded(sender.email)) continue;

        const state = this._getAccountState(sender.email);
        if (!state || !state.is_active) continue;

        // Check daily limit
        if (state.sent_today >= state.max_daily) continue;

        await this._sendWarmup(sender, receiver);
        this._updateAccountState(sender.email, today);

        const delay = 30000 + Math.random() * 120000;
        await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        console.error(`[WARMUP] Error ${sender.email} -> ${receiver.email}: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  _getAccountState(email) {
    if (!this.db) return null;
    try {
      const row = this.db.prepare('SELECT * FROM warmup_state WHERE account_email = ?').get(email);
      if (!row) return null;

      // Reset daily counter if new day
      const lastReset = row.last_reset?.slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (lastReset !== today) {
        this.db.prepare('UPDATE warmup_state SET sent_today = 0, last_reset = datetime(\'now\') WHERE id = ?').run(row.id);
        row.sent_today = 0;
      }

      // Progress to next day after reaching daily target
      const rampUpDays = this.config.warmup?.ramp_up_days || 14;
      const targetDaily = this.config.warmup?.target_daily || 80;
      if (row.sent_today >= row.max_daily && row.day < rampUpDays) {
        const nextDay = row.day + 1;
        const nextMax = nextDay < WARMUP_SCHEDULE.length ? WARMUP_SCHEDULE[nextDay] : targetDaily;
        this.db.prepare('UPDATE warmup_state SET day = ?, max_daily = ? WHERE id = ?').run(nextDay, nextMax, row.id);
        row.day = nextDay;
        row.max_daily = nextMax;
        console.info(`[WARMUP] ${email} advanced to day ${nextDay} (max: ${nextMax}/day)`);
      }

      return row;
    } catch { return null; }
  }

  _updateAccountState(email, today) {
    if (!this.db) return;
    try {
      this.db.prepare('UPDATE warmup_state SET sent_today = sent_today + 1, total_sent = total_sent + 1 WHERE account_email = ?').run(email);
    } catch {}
  }

  async _sendWarmup(sender, receiver) {
    const transporter = nodemailer.createTransport({
      host: sender.host,
      port: sender.port,
      secure: sender.port === 465,
      auth: { user: sender.email, pass: sender.password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    const content = await this._generateContent(sender.email, receiver.email);
    await transporter.sendMail({
      from: `"${sender.name || 'Professional Networking'}" <${sender.email}>`,
      to: receiver.email,
      subject: content.subject,
      text: content.body,
      headers: { 'X-Warmup-Type': 'Professional-Social', 'X-Warmup-Day': String(this._getDay(sender.email)) },
    });

    console.info(`[WARMUP] Sent: ${sender.email} -> ${receiver.email}`);
  }

  async _generateContent(senderEmail, receiverEmail) {
    const topics = [
      'cloud infrastructure trends', 'cybersecurity best practices 2026',
      'remote team collaboration', 'IT budget optimization',
      'zero trust security', 'AI in enterprise IT',
      'digital transformation strategy', 'incident response planning',
      'data privacy compliance', 'network architecture modernization',
    ];
    const topic = topics[Math.floor(Math.random() * topics.length)];
    const templates = [
      `Hey, been reading about ${topic} lately and thought of our last conversation. Would love to hear your take on it.`,
      `Hope you're doing well. Came across an interesting article about ${topic} — reminded me of your team's work.`,
      `Quick check-in! I've been exploring ${topic} and was curious if you've had any experience implementing it.`,
      `Hope all is well. I was just reviewing some notes on ${topic} and thought I'd reach out.`,
      `Been thinking about ${topic} and how it applies to what we discussed last quarter. Keen to exchange thoughts.`,
    ];
    const body = templates[Math.floor(Math.random() * templates.length)];

    if (!this.openai) {
      return {
        subject: ['Quick thought', 'Just checking in', 'Hope you\'re well', 'Following up', 'Quick question'][Math.floor(Math.random() * 5)],
        body,
      };
    }

    try {
      const resp = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'user',
          content: `Write a short professional email (2-3 sentences) as a friendly check-in between colleagues discussing "${topic}". Make it natural and varied. Output JSON: {"subject": "...", "body": "..."}`,
        }],
        response_format: { type: 'json_object' },
        max_tokens: 200,
        temperature: 0.9,
      });
      return JSON.parse(resp.choices[0].message.content);
    } catch {
      return { subject: 'Quick thought on ' + topic, body };
    }
  }

  _getDay(email) {
    if (!this.db) return 0;
    const row = this.db.prepare('SELECT day FROM warmup_state WHERE account_email = ?').get(email);
    return row?.day || 0;
  }

  _getPool() {
    const pool = (this.config.smtp_pool || []).map(p => ({
      email: p.username, password: p.password, host: p.host, port: p.port, name: p.name,
    }));

    if (this.config.smtp_username && !pool.find(p => p.email === this.config.smtp_username)) {
      pool.push({
        email: this.config.smtp_username, password: this.config.smtp_password,
        host: this.config.smtp_host || 'smtp.yandex.com', port: this.config.smtp_port || 465, name: this.config.smtp_from_name,
      });
    }

    return pool.filter(p => !this._isExcluded(p.email));
  }

  _isExcluded(email) {
    const lower = String(email || '').trim().toLowerCase();
    if (!lower) return true;
    const blocked = (this.config.warmup?.exclude_domains || this.config.warmup_exclude_emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
    if (this.config.notification_email) blocked.push(String(this.config.notification_email).trim().toLowerCase());
    if (this.config.smtp_from_email) blocked.push(String(this.config.smtp_from_email).trim().toLowerCase());
    return blocked.includes(lower) || blocked.some(b => lower.endsWith('@' + b.replace(/^@/, '')));
  }
}
