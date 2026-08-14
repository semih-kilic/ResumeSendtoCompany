import { initDatabase } from './db.js';
import path from 'path';

const db = initDatabase(path.join(process.cwd(), 'data', 'canada.db'));
const total = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
const yp = db.prepare("SELECT COUNT(*) as count FROM companies WHERE business_id LIKE 'CA-YP%'").get().count;

console.log('--- DATABASE STATUS ---');
console.log('TOTAL COMPANIES:', total);
console.log('YELLOWPAGES COMPANIES:', yp);

const recent = db.prepare('SELECT company_name, business_id, fetched_at FROM companies ORDER BY fetched_at DESC LIMIT 10').all();
console.log('--- RECENT 10 ---');
console.log(recent);
