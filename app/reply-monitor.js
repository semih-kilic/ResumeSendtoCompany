import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import { markAsReplied, updateApplicationStatus } from './db.js';

/**
 * Reply Monitor Service
 * Connects to IMAP accounts and analyzes incoming replies using AI.
 */
export class ReplyMonitor {
    constructor(db, config, aiAdvisor) {
        this.db = db;
        this.config = config;
        this.aiAdvisor = aiAdvisor;
    }

    async start() {
        console.log('[REPLY-MONITOR] Disabled by operator. Skipping inbox sweep.');
        return;

        console.log('[REPLY-MONITOR] Starting inbox intelligence sweep...');
        const accounts = this._getImapAccounts();
        
        for (const account of accounts) {
            try {
                await this.processAccount(account);
            } catch (err) {
                console.error(`[REPLY-MONITOR] Error processing account ${account.user}:`, err.message);
            }
        }
    }

    _getImapAccounts() {
        // Include both main pool and SaaS pool
        const pools = [
            ...(this.config.smtp_pool || []),
            ...(this.config.saas_smtp_pool || [])
        ];

        const accounts = pools
            .filter(p => p.host && (p.host.includes('gmail') || p.host.includes('yandex')))
            .map(p => ({
                imapConfig: {
                    imap: {
                        user: p.username,
                        password: p.password,
                        host: p.host.replace('smtp', 'imap'),
                        port: 993,
                        tls: true,
                        tlsOptions: { rejectUnauthorized: false },
                        authTimeout: 30000
                    }
                },
                user: p.username
            }));
        return accounts;
    }

    async processAccount(account) {
        let connection;
        try {
            connection = await imaps.connect(account.imapConfig);
            await connection.openBox('INBOX', true); // Open in READ-ONLY mode to be safe

            const searchCriteria = ['UNSEEN'];
            const fetchOptions = { bodies: ['HEADER', 'TEXT'], struct: true };

            const messages = await connection.search(searchCriteria, fetchOptions);
            if (messages.length > 0) {
                console.log(`[REPLY-MONITOR] Found ${messages.length} new message(s) in ${account.user}`);
            }

            for (const msg of messages) {
                const all = msg.parts?.find(part => part.which === 'TEXT');
                if (!all || !all.body) {
                    console.warn(`[REPLY-MONITOR] Skipping message with no TEXT part`);
                    continue;
                }
                const mail = await simpleParser(all.body);
                const fromRaw = mail.from?.value?.[0]?.address || mail.from?.text || '';
                const fromEmail = fromRaw.toLowerCase().match(/<([^>]+)>/)?.[1] || fromRaw.toLowerCase();
                const subject = mail.subject || '';
                const body = mail.text || '';

                // Determine campaign type
                const isSaaS = this.db.prepare('SELECT 1 FROM send_log_saas WHERE LOWER(email) = ?').get(fromEmail);
                const campaignType = isSaaS ? 'saas' : 'job';

                // Categorize via AI
                const analysis = isSaaS 
                    ? await this.aiAdvisor.analyzeSalesIntent(body, subject)
                    : await this.aiAdvisor.analyzeSentiment(body, subject);
                
                // Store in DB
                this.db.prepare(`
                    INSERT INTO replies (email, company_name, subject, body, sentiment, received_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                `).run(fromEmail, isSaaS ? 'SaaS Lead' : 'Job Lead', subject, body, analysis);

                // [V3] Intelligent Follow-Up Pausing: Mark lead as replied so the engine skips them
                markAsReplied(this.db, fromEmail);
                this.db.prepare('UPDATE send_log_saas SET followup_sent = 1 WHERE LOWER(email) = ?').run(fromEmail);

                if (!isSaaS) {
                  const appStatus = analysis === 'rejected' ? 'rejected'
                    : (analysis === 'interested' || analysis === 'curious') ? 'replied'
                    : 'replied';
                  updateApplicationStatus(this.db, fromEmail, appStatus);
                }
                console.log(`[REPLY-MONITOR] 🛑 Halting automated follow-ups for ${fromEmail}`);

                // If positive, forward to Semih
                const positiveJob = (analysis === 'interested' || analysis === 'curious');
                const positiveSaaS = (analysis === 'interested' || analysis === 'pricing' || analysis === 'demo');

                if (positiveJob || positiveSaaS) {
                    await this.forwardToUser(fromEmail, subject, body, analysis, campaignType);
                }
            }
        } finally {
            if (connection) connection.end();
        }
    }

    async forwardToUser(from, subject, body, sentiment, type) {
        if (!this.config.notifications_enabled || !this.config.notification_email) {
            return;
        }
        const isSaaS = type === 'saas';
        console.log(`[REPLY-MONITOR] 🎯 POSITIVE ${type.toUpperCase()} REPLY from ${from}. Forwarding...`);
        
        const transporter = nodemailer.createTransport({
            host: this.config.smtp_host || 'smtp.yandex.com',
            port: this.config.smtp_port || 465,
            secure: true,
            auth: {
                user: this.config.smtp_username,
                pass: this.config.smtp_password
            }
        });

        const alertBody = `
        <h3>🎯 ${isSaaS ? 'SaaS Sales Opportunity!' : 'Job Interview Request!'}</h3>
        <p><strong>From:</strong> ${from}</p>
        <p><strong>Campaign:</strong> ${isSaaS ? 'CyberSec Pro' : 'Canada Job Outreach'}</p>
        <p><strong>Analysis:</strong> ${sentiment.toUpperCase()}</p>
        <hr>
        <p><strong>Message:</strong></p>
        <pre>${body}</pre>
        <br>
        <p><i>OMEGA Engine Intelligence System</i></p>
        `;

        await transporter.sendMail({
            from: `"OMEGA Intelligence" <${this.config.smtp_username}>`,
            to: this.config.notification_email,
            subject: `🚨 [${isSaaS ? 'SALES' : 'OPPORTUNITY'}] ${from} replied!`,
            html: alertBody
        });
    }
}
