import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'canada.db');
const db = new Database(dbPath);

console.log('--- DATABASE STATUS REPORT ---');

const companies = db.prepare("SELECT count(*) as count FROM companies").get();
console.log(`Total Companies Discovered: ${companies.count}`);

const emails = db.prepare("SELECT count(*) as count FROM email_records").get();
console.log(`Total Emails Harvested: ${emails.count}`);

const sent = db.prepare("SELECT count(*) as count FROM send_log").get();
console.log(`Total Emails Sent: ${sent.count}`);

const replies = db.prepare("SELECT count(*) as count FROM replies").get();
console.log(`Total Replies Received: ${replies.count}`);

console.log('\n--- RECENT REPLIES ---');
const recentReplies = db.prepare("SELECT email, subject, sentiment, received_at FROM replies ORDER BY received_at DESC LIMIT 5").all();
recentReplies.forEach(r => console.log(`[${r.received_at}] From: ${r.email} | Sentiment: ${r.sentiment} | Sub: ${r.subject}`));

db.close();
