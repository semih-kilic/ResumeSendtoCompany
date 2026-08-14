import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { getUnsent, insertSendLog, saveEmailFitEvaluation } from './db.js';
import { PdfEngine } from './pdf-engine.js';
import { DeadLetterQueue, CircuitBreaker, RetryManager } from './resilience-manager.js';
import { evaluateCompanyFit } from './job-fit-evaluator.js';
import { ResendProvider } from './resend-provider.js';
import { normalizeEmail, isValidEmailForSend } from './email-utils.js';
import { logProviderUsage } from './metrics.js';
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

export class SendEngine extends EventEmitter {
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
      skippedFit: 0,
      dryRun: false,
      activeProvider: 'smtp' // 'resend' | 'smtp'
    };
    this.paused = false;
    this.stopped = false;
    this.consecutiveSpamErrors = 0;
    this.SPAM_PAUSE_THRESHOLD = 5;
    this.currentSmtpIndex = -1; // -1 = primary, 0+ = pool index
    this._smtpExhaustedAt = null;
    this.resendProvider = new ResendProvider(config, (level, msg) => this._log(level, msg));
    
    // Resilience managers
    this.dlq = new DeadLetterQueue(db);
    this.resendBreaker = new CircuitBreaker('resend-email', { 
      failureThreshold: 5, 
      timeoutSecs: 300,
    });
    this.smtpBreaker = new CircuitBreaker('smtp-email', { 
      failureThreshold: 3, 
      timeoutSecs: 120,
    });
    this.retryManager = new RetryManager({
      maxRetries: 2,
      initialDelayMs: 5000,
      maxDelayMs: 30000,
    });
  }

  getState() { return { ...this.state }; }

  async start(dryRun = false) {
    if (this.state.status === 'running') return;

    const sentInDb = this.db.prepare('SELECT COUNT(*) as count FROM send_log').get().count;
    const remainingCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM email_records 
      WHERE excluded = 0 AND email NOT IN (SELECT email FROM send_log)
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

    if (!dryRun) {
      if (useResend) {
        resend = await getResendClient(resendApiKey);
      } else {
        transporter = this._createTransporter();
      }
    }

    let round = 1;
    while (true) {
      if (this.stopped) break;
      const unsent = getUnsent(this.db);
      this.state.totalRecipients = this.state.sent + this.state.failed + unsent.length;
      this._emitProgress();

      if (unsent.length === 0) {
        this._log('info', '📭 [AUTONOMOUS] No more unsent emails. Waiting 5 minutes for new discoveries...');
        // Wait 5 minutes before checking again, unless stopped
        for (let i = 0; i < 300; i++) {
          if (this.stopped) break;
          updateHeartbeat();
          await new Promise(r => setTimeout(r, 1000));
        }
        continue; // Check again
      }

      this._log('info', `🚀 [AUTONOMOUS] [ROUND ${round}] Processing ${unsent.length} targets.`);

      // Load template
      const templatePath = path.join(engineRootDir, 'templates', 'outreach.html');
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

        let retryCount = 0;
        const MAX_SMTP_RETRIES = 2;

        try {
          record.email = normalizeEmail(record.email) || record.email;

          if (!isValidEmailForSend(record.email)) {
            this._log('warn', `[VALIDATE] Skipping invalid email: ${record.email}`);
            this.db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(record.id);
            this.state.failed++;
            this._emitProgress();
            continue;
          }

          // --- Job fit evaluation (ai-job-search framework) ---
          let fitResult = null;
          if (this.config.job_fit_enabled !== false) {
            const minScore = this.config.job_fit_min_score ?? 45;
            if (record.fit_score != null) {
              fitResult = { overallScore: record.fit_score, verdict: record.fit_verdict, source: 'cached' };
            } else {
              fitResult = await evaluateCompanyFit(this.aiAdvisor, {
                companyName: record.company_name,
                website: record.website,
                emailType: record.email_type,
                websiteSnippet: record.ai_intro || '',
              });
              saveEmailFitEvaluation(this.db, record.email, fitResult.overallScore, fitResult.verdict);
              this._log('info', `[JOB-FIT] ${record.company_name}: ${fitResult.overallScore}/100 (${fitResult.verdict}) [${fitResult.source}]`);
            }

            if (fitResult.overallScore < minScore) {
              this._log('info', `[JOB-FIT] Skipping weak fit (${fitResult.overallScore} < ${minScore}): ${record.email}`);
              this.db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(record.id);
              this.state.skippedFit++;
              this._emitProgress();
              continue;
            }
          }

          // --- Anti-blacklist: bounce check + domain throttling ---
          if (isBounced(record.email)) {
            this._log('warn', `[BOUNCE-GUARD] Skipping ${record.email} — previously bounced`);
            this.db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(record.id);
            this.state.failed++;
            this._emitProgress();
            continue;
          }

          const domain = record.email.split('@')[1];
          if (domain) {
            const domainCheck = canSendToDomain(domain, 'main');
            if (!domainCheck.allowed) {
              this._log('warn', `[DOMAIN-THROTTLE] ${domain}: ${domainCheck.reason}. Delaying...`);
              await new Promise(r => setTimeout(r, domainCheck.reason.includes('minute') ? 12000 : 300000));
            }
            const accountCheck = checkDailyAccountCap(this._getActiveEmail(), 'main');
            if (!accountCheck.allowed) {
              this._log('warn', `[ACCOUNT-CAP] ${accountCheck.reason}. Delaying 5 minutes...`);
              await new Promise(r => setTimeout(r, 300000));
            }
          }

          // --- Drafter-reviewer pass on intro ---
          let introText = record.ai_intro;
          if (introText && this.config.outreach_review_enabled !== false && this.aiAdvisor?.reviewOutreachDraft) {
            const reviewed = await this.aiAdvisor.reviewOutreachDraft(introText, record.company_name, record.website || '');
            if (reviewed && reviewed !== introText) {
              introText = reviewed;
              this.db.prepare('UPDATE email_records SET ai_intro = ? WHERE email = ?').run(introText, record.email);
              this._log('debug', `[REVIEWER] Refined intro for ${record.company_name}`);
            }
          }

          const personalizedIntro = introText ? `<p style="color:#2c5282;font-style:italic;margin-bottom:20px;">${introText}</p>` : '';
          let htmlBody = template
            .replace(/\{\{company_name\}\}/g, record.company_name)
            .replace(/\{\{personalized_intro\}\}/g, personalizedIntro);
          
          // --- Inject Tracking Pixel ---
          if (this.config.tracking_base_url) {
            const trackId = `job_${Buffer.from(record.email).toString('base64')}`;
            const pixelUrl = `${this.config.tracking_base_url.replace(/\/$/, '')}/t/${trackId}`;
            htmlBody += `<img src="${pixelUrl}" width="1" height="1" style="display:none !important;" alt="" />`;
          }

          const subject = this.config.email_subject
            .replace(/\{\{company_name\}\}/g, record.company_name);

          const plainText = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

          if (dryRun) {
            this._log('info', `[DRY RUN] Target: ${record.email}`);
          } else {
            // Build attachments
            const attachments = await this._buildAttachments(engineRootDir, record.company_name);

            // ── Try Resend first ──────────────────────────────────
            if (resend && this.resendProvider.isAvailable()) {
              const sent = await this._sendViaResend(resend, record, htmlBody, plainText, attachments, subject);
              if (sent === 'ok') {
                this._log('info', `✅ [SENT via Resend] [R${round}] ${record.email}`);
                insertSendLog(this.db, record.email, record.company_name, {
                  fitScore: fitResult?.overallScore,
                  fitVerdict: fitResult?.verdict,
                });
                this.state.sent++;
                this.consecutiveSpamErrors = 0;
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

            const activePool = this.config.smtp_pool || [];
            const activePoolItem = (this.currentSmtpIndex >= 0 && activePool[this.currentSmtpIndex]);
            const activeUser = activePoolItem ? activePoolItem.username : this.config.smtp_username;
            const activeFromEmail = activePoolItem
              ? (activePoolItem.from_email || activePoolItem.username)
              : (this.config.smtp_from_email || activeUser);

            const mailOptions = {
              from: `"${this.config.smtp_from_name}" <${activeFromEmail}>`,
              to: record.email,
              subject: subject,
              html: htmlBody,
              text: plainText,
              attachments: attachments.smtp // for nodemailer
            };

            const t0Send = Date.now();
            await Promise.race([
              transporter.sendMail(mailOptions),
              new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP Send Timeout')), 45000))
            ]);
            this._log('info', `✅ [SENT via SMTP] [R${round}] ${record.email}`);
            logProviderUsage({ provider: 'smtp', action: 'send_email', status: 'success', durationMs: Date.now() - t0Send, target: record.email });
            
            // [V3] ROUND-ROBIN SMTP: Force rotation after every successful send to distribute load
            if (this.config.smtp_pool && this.config.smtp_pool.length > 1) {
              this._rotateSmtp();
              transporter = this._createTransporter();
            }
          }

          insertSendLog(this.db, record.email, record.company_name, {
            fitScore: fitResult?.overallScore,
            fitVerdict: fitResult?.verdict,
          });
          this.state.sent++;
          this.consecutiveSpamErrors = 0;
          currentDelay = Math.max(MIN_DELAY, currentDelay - 2000);

        } catch (e) {
          currentDelay = Math.min(MAX_DELAY, currentDelay + 15000);
          this.state.failed++;
          this._log('error', `❌ [FAILED] Error for ${record.email}: ${e.message}`);
          logProviderUsage({ provider: this.state.activeProvider || 'smtp', action: 'send_email', status: 'failure', target: record.email, error: e.message });

          const errMsg = e.message.toLowerCase();

          // Sender-side errors — rotate SMTP
          const isSenderError = errMsg.includes('550-5.4.5') || errMsg.includes('limit') ||
                                errMsg.includes('quota') || errMsg.includes('spam') ||
                                errMsg.includes('blocked') || errMsg.includes('auth') ||
                                errMsg.includes('refused') || (errMsg.includes('550') && errMsg.includes('sending'));

          if (isSenderError) {
            this.consecutiveSpamErrors++;
            this._log('error', `[REPUTATION-GUARD] Spam block or sender limit on current account. Rotating SMTP pool...`);
            const rotated = this._rotateSmtp();
            if (!rotated) {
              const resumed = await this._waitForSmtpPoolReset(updateHeartbeat);
              if (resumed) {
                transporter = this._createTransporter();
                retryCount++;
                if (retryCount < MAX_SMTP_RETRIES) continue;
              }
              this._log('error', '[RESILIENCE] All SMTP accounts exhausted. Moving to Dead Letter Queue for later retry.');
              this.dlq.addItem('email', record.email, {
                email: record.email,
                company_name: record.company_name,
                ai_intro: record.ai_intro,
              }, new Error('All SMTP accounts exhausted - sender reputation issue'), 10);
              this._emitProgress();
              continue; // Skip this email but don't stop or pause
            } else {
              transporter = this._createTransporter();
              this.consecutiveSpamErrors = 0;
              retryCount++;
              if (retryCount >= MAX_SMTP_RETRIES) {
                this._log('warn', `[RETRY-LIMIT] Max retries (${MAX_SMTP_RETRIES}) reached for ${record.email}. Moving to DLQ.`);
                this.dlq.addItem('email', record.email, {
                  email: record.email,
                  company_name: record.company_name,
                  ai_intro: record.ai_intro,
                }, new Error('Max SMTP retries exhausted'), 5);
                this._emitProgress();
                continue;
              }
              this._log('info', `[RETRY ${retryCount}/${MAX_SMTP_RETRIES}] Attempting to resend to ${record.email} with new SMTP node...`);
              continue; 
            }
          }

          // Definitive bounce — blacklist domain
          if (errMsg.includes('mailbox') || errMsg.includes('user unknown') ||
              errMsg.includes('not found') || errMsg.includes('no such user') ||
              errMsg.includes('unroutable') || (errMsg.includes('invalid') && !errMsg.includes('credentials')) ||
              errMsg.includes('does not exist') || errMsg.includes('unknown') ||
              errMsg.includes('550 5.1.1') || errMsg.includes('550-5.1.1')) {
            this._log('warn', `[BOUNCE] ${record.email} is dead. Excluding and penalizing domain.`);
            try {
              recordBounce(record.email, 'hard', 'main');
              this.db.prepare('UPDATE email_records SET excluded = 1 WHERE email = ?').run(record.email);
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
      if (this.stopped) break;
      
      // ✨ RESILIENCE: Process Dead Letter Queue before waiting
      this._log('info', `📬 [DLQ] Checking Dead Letter Queue for retry candidates...`);
      await this._processDLQ(dryRun, resend, transporter);

      const pauseMins = this.config.batch_pause_mins || 30;
      this._log('info', `🏁 [ROUND FINISHED] Waiting ${pauseMins} minutes before starting next round...`);
      for (let i = 0; i < pauseMins * 60; i++) {
        if (this.stopped) break;
        updateHeartbeat();
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  /**
   * Process items from Dead Letter Queue
   */
  async _processDLQ(dryRun, resend, transporter) {
    const dlqItems = this.dlq.getPendingItems(20); // Process up to 20 items per round
    if (dlqItems.length === 0) {
      this._log('debug', `[DLQ] No pending items`);
      return;
    }
    
    this._log('info', `[DLQ] Processing ${dlqItems.length} dead letter items...`);
    
    for (const dlqItem of dlqItems) {
      if (this.stopped) break;
      
      try {
        const payload = JSON.parse(dlqItem.payload);
        const email = payload.email;
        
        this._log('info', `[DLQ] Retrying ${email} (retry count: ${dlqItem.retry_count}/${dlqItem.max_retries})`);
        
        // Use graceful retry with smaller backoff
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
        
        if (!dryRun && resend) {
          // Try Resend first
          try {
            await this.resendBreaker.execute(async () => {
              return await resend.emails.send({
                from: `${this.config.smtp_from_name} <${this.config.smtp_from_email}>`,
                to: email,
                subject: `[Retry] ${this.config.email_subject.replace(/\{\{company_name\}\}/g, payload.company_name || 'Our Company')}`,
                html: payload.html || `<p>Retry attempt for ${email}</p>`,
              });
            });
            this._log('info', `[DLQ] ✅ Successfully resent to ${email} via Resend`);
            insertSendLog(this.db, email, payload.company_name);
            this.dlq.markCompleted(dlqItem.id);
            this.state.sent++;
            continue;
          } catch (err) {
            this._log('warn', `[DLQ] Resend retry failed: ${err.message}`);
          }
        }
        
        if (!dryRun && transporter) {
          // Fallback to SMTP
          try {
            await this.smtpBreaker.execute(async () => {
              return await transporter.sendMail({
                from: `"${this.config.smtp_from_name}" <${this.config.smtp_from_email}>`,
                to: email,
                subject: `[Retry] ${this.config.email_subject.replace(/\{\{company_name\}\}/g, payload.company_name || 'Our Company')}`,
                html: payload.html || `<p>Retry attempt for ${email}</p>`,
              });
            });
            this._log('info', `[DLQ] ✅ Successfully resent to ${email} via SMTP`);
            insertSendLog(this.db, email, payload.company_name);
            this.dlq.markCompleted(dlqItem.id);
            this.state.sent++;
            continue;
          } catch (err) {
            this._log('warn', `[DLQ] SMTP retry failed: ${err.message}`);
          }
        }
        
        // Mark for retry if not max retries
        if (dlqItem.retry_count < dlqItem.max_retries) {
          this.dlq.markRetried(dlqItem.id);
          this._log('info', `[DLQ] Marked ${email} for retry later`);
        } else {
          this.dlq.markFailed(dlqItem.id);
          this._log('error', `[DLQ] FAILED ${email} - max retries exceeded`);
        }
      } catch (err) {
        this._log('error', `[DLQ] Error processing item: ${err.message}`);
      }
    }
    
    const stats = this.dlq.getStats();
    this._log('info', `[DLQ] Stats: ${JSON.stringify(stats)}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Resend sender
  // Returns: 'ok' | 'retry' | 'disabled'
  // ─────────────────────────────────────────────────────────────────
  async _sendViaResend(resend, record, htmlBody, plainText, attachments, subject) {
    const t0 = Date.now();
    try {
      const { from, replyTo } = this.resendProvider.getFromAddress('job');
      const payload = {
        from,
        reply_to: replyTo,
        to: [record.email],
        subject: subject,
        html: htmlBody,
        text: plainText,
      };

      if (attachments.resend.length > 0) {
        payload.attachments = attachments.resend;
      }

      const { error } = await resend.emails.send(payload);
      const result = this.resendProvider.classifyError(error);
      if (result === 'ok') {
        logProviderUsage({ provider: 'resend', action: 'send_email', status: 'success', durationMs: Date.now() - t0, target: record.email });
      } else {
        logProviderUsage({ provider: 'resend', action: 'send_email', status: result === 'cooldown' ? 'rate_limit' : 'failure', durationMs: Date.now() - t0, target: record.email, error: error?.message });
      }
      return result;
    } catch (err) {
      this._log('warn', `[Resend] Exception: ${err.message}`);
      logProviderUsage({ provider: 'resend', action: 'send_email', status: 'failure', durationMs: Date.now() - t0, target: record.email, error: err.message });
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
        
        // [V3] Hyper-Personalized AI CV Generation
        if (this.aiAdvisor) {
            this._log('info', `[AI-CV] Generating hyper-personalized CV summary for ${companyName}...`);
            const dynamicSummary = await this.aiAdvisor.generateDynamicCVSummary(companyName, null, profileData.SUMMARY_TEXT);
            profileData.SUMMARY_TEXT = dynamicSummary;
        } else {
            profileData.SUMMARY_TEXT = profileData.SUMMARY_TEXT.replace(
              'actively seeking opportunities',
              `actively seeking opportunities at ${companyName}`
            );
        }

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
      skipped_fit: this.state.skippedFit,
      status: this.state.status,
      dry_run: this.state.dryRun,
      active_provider: this.state.activeProvider
    });
  }

  _createTransporter() {
    let host = this.config.smtp_host;
    let port = this.config.smtp_port;
    let secure = this.config.smtp_tls;
    let user = this.config.smtp_username;
    let pass = this.config.smtp_password;

    if (this.currentSmtpIndex >= 0 && this.config.smtp_pool &&
        this.currentSmtpIndex < this.config.smtp_pool.length) {
      const poolCfg = this.config.smtp_pool[this.currentSmtpIndex];
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
    const poolSize = (this.config.smtp_pool && Array.isArray(this.config.smtp_pool))
      ? this.config.smtp_pool.length : 0;
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
    const poolCfg = this.config.smtp_pool[this.currentSmtpIndex];
    this._log('info', `Rotating to SMTP pool provider #${this.currentSmtpIndex + 1} (${poolCfg.host} - ${poolCfg.username})`);
    return true;
  }

  async _waitForSmtpPoolReset(updateHeartbeat) {
    if (!this._smtpExhaustedAt) return true;

    const cooldownMs = (this.config.smtp_pool_cooldown_mins || 60) * 60 * 1000;
    const elapsed = Date.now() - this._smtpExhaustedAt;
    const remaining = cooldownMs - elapsed;

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
    this._log('info', '[SMTP] Pool cooldown complete — resuming sends.');
    return true;
  }

  _getActiveEmail() {
    const pool = this.config.smtp_pool || [];
    if (this.currentSmtpIndex >= 0 && pool[this.currentSmtpIndex]) {
      return pool[this.currentSmtpIndex].username || pool[this.currentSmtpIndex].from_email || this.config.smtp_from_email;
    }
    return this.config.smtp_from_email || this.config.smtp_username || '';
  }

  _log(level, message) {
    this.emit('log', { level, message, ts: new Date().toISOString() });
  }
}
