import { initDatabase } from './db.js';
import path from 'path';

const db = initDatabase(path.join(process.cwd(), 'data', 'canada.db'));

try {
    const totalCompanies = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
    const totalEmails = db.prepare('SELECT COUNT(*) as count FROM email_records').get().count;
    const _uniqueCompaniesWithEmails = db.prepare('SELECT COUNT(DISTINCT business_id) as count FROM email_records').get().count;
    const verifiedEmails = db.prepare('SELECT COUNT(*) as count FROM email_records WHERE verified = 1').get().count;
    const sentCount = db.prepare('SELECT COUNT(*) as count FROM send_log').get().count;

    console.log('--- OMEGA STATUS REPORT ---');
    console.log('Total Companies Discovered:', totalCompanies);
    console.log('Total Email Addresses Found:', totalEmails);
    console.log('Verified Emails (Ready to Send):', verifiedEmails);
    console.log('Total Successful Outreach Mails:', sentCount);
    console.log('---------------------------');
} catch (e) {
    console.error('Error generating report:', e.message);
}
