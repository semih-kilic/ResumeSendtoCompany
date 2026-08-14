import { initDatabase } from './db.js';
import path from 'path';

const db = initDatabase(path.join(process.cwd(), 'data', 'canada.db'));

try {
    const trashNames = [
        'About', 'About Us', 'Contact', 'Privacy', 'Home', 'Services', 
        'Careers', 'Blog', 'Support', 'Legal', 'Terms', 'Conditions',
        'Facebook', 'Twitter', 'LinkedIn', 'Instagram', 'YouTube', 'Google',
        'Sign In', 'Log In', 'Register', 'Login', 'Join Us', 'More', 'Read More',
        'Follow Us', 'Contact Us', 'Our Team', 'Privacy Policy', 'Terms of Use'
    ];
    
    const placeholders = trashNames.map(() => '?').join(',');
    const result = db.prepare(`DELETE FROM companies WHERE company_name IN (${placeholders}) OR LENGTH(company_name) < 3`).run(...trashNames);
    
    console.log(`DELETED ${result.changes} TRASH RECORDS.`);
    
    const total = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
    console.log(`REMAINING VALID COMPANIES: ${total}`);
} catch (e) {
    console.error('CLEANUP ERROR:', e.message);
}
