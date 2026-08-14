import { initDatabase } from '../db.js';

const db = initDatabase('./data/canada.db');
const g = (s) => db.prepare(s).get().c;

console.log(JSON.stringify({
  totalEmails: g('SELECT COUNT(*) c FROM email_records'),
  verified: g('SELECT COUNT(*) c FROM email_records WHERE verified=1'),
  excluded: g('SELECT COUNT(*) c FROM email_records WHERE excluded=1'),
  unsentJob: g(`SELECT COUNT(*) c FROM email_records er WHERE er.excluded=0 AND er.verified=1 AND er.business_id NOT LIKE 'SAAS-%' AND LOWER(er.email) NOT IN (SELECT LOWER(email) FROM send_log)`),
  unsentSaaS: g(`SELECT COUNT(*) c FROM email_records er WHERE er.excluded=0 AND er.verified=1 AND er.business_id LIKE 'SAAS-%' AND LOWER(er.email) NOT IN (SELECT LOWER(email) FROM send_log_saas)`),
  fitSkipped: g('SELECT COUNT(*) c FROM email_records WHERE fit_score IS NOT NULL AND fit_score < 45 AND excluded=1'),
  sentJob: g('SELECT COUNT(*) c FROM send_log'),
  sentSaaS: g('SELECT COUNT(*) c FROM send_log_saas'),
  companies: g('SELECT COUNT(*) c FROM companies'),
  emailTypesGeneral: g("SELECT COUNT(*) c FROM email_records WHERE email_type='general'"),
}, null, 2));

db.close();
