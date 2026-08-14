import Database from 'better-sqlite3';
import path from 'path';
import { loadConfig } from './config.js';
import { AIAdvisor } from './ai-advisor.js';
import nodemailer from 'nodemailer';

async function reprocessUnknowns() {
    console.log('🔄 Starting Re-processing of Unknown Replies...');
    
    const config = loadConfig();
    const dbPath = path.join(process.cwd(), 'data', 'canada.db');
    const db = new Database(dbPath);
    const ai = new AIAdvisor(config);

    const unknowns = db.prepare("SELECT * FROM replies WHERE sentiment = 'unknown'").all();
    console.log(`Found ${unknowns.length} unknown replies to re-process.`);

    for (const reply of unknowns) {
        console.log(`Analyzing: ${reply.email} - ${reply.subject}`);
        const sentiment = await ai.analyzeSentiment(reply.body, reply.subject);
        
        db.prepare("UPDATE replies SET sentiment = ? WHERE id = ?").run(sentiment, reply.id);
        console.log(`-> New Sentiment: ${sentiment}`);

        if (sentiment === 'interested' || sentiment === 'curious') {
            console.log(`🎯 POSITIVE DETECTED! Forwarding to Semih...`);
            await forwardToUser(config, reply.email, reply.subject, reply.body, sentiment);
        }
    }

    console.log('✅ Re-processing complete.');
    process.exit(0);
}

async function forwardToUser(config, from, subject, body, sentiment) {
    const transporter = nodemailer.createTransport({
        host: config.smtp_host || 'smtp.yandex.com',
        port: config.smtp_port || 465,
        secure: true,
        auth: {
            user: config.smtp_username,
            pass: config.smtp_password
        }
    });

    const alertBody = `
    <h3>🎯 [RE-PROCESSED] Pozitif Geri Dönüş!</h3>
    <p><strong>Gönderen:</strong> ${from}</p>
    <p><strong>Konu:</strong> ${subject}</p>
    <p><strong>Yapay Zeka Analizi:</strong> ${sentiment.toUpperCase()}</p>
    <hr>
    <pre>${body}</pre>
    `;

    await transporter.sendMail({
        from: `"Canada Alpha Alert" <${config.smtp_username}>`,
        to: "semihkilic@semihkilic.com",
        subject: `🚨 [FIRSAT] ${from} üzerinden yeni tespit!`,
        html: alertBody
    });
}

reprocessUnknowns();
