const Database = require('better-sqlite3');
const db = new Database('data/canada.db');

// What categories do we have in scan-engine?
const categories = [
  'IT services', 'software development', 'cybersecurity', 'cloud consulting',
  'managed services', 'digital transformation', 'AI consulting',
  'engineering consulting', 'mechanical engineering', 'civil engineering',
  'electrical engineering', 'environmental engineering',
  'construction management', 'general contracting', 'commercial construction',
  'architecture', 'interior design', 'project management',
  'accounting', 'CPA', 'tax advisory', 'financial consulting',
  'law firm', 'corporate law', 'intellectual property law',
  'medical devices', 'biotechnology', 'pharmaceutical manufacturing',
  'renewable energy', 'environmental consulting',
  'logistics', 'supply chain', 'freight forwarding',
  'digital marketing', 'SEO agency', 'content marketing',
  'HR consulting', 'executive search', 'staffing',
  // SMB categories
  'restaurant', 'cafe', 'bakery', 'dentist', 'plumber', 'electrician',
  'real estate agency', 'auto repair', 'gym', 'salon', 'spa',
  'law office', 'accounting firm', 'insurance agency', 'travel agency',
  'hotel', 'pet store', 'veterinary', 'pharmacy',
  'medical clinic', 'dental clinic', 'coffee shop',
];

console.log('=== DISCOVERY COVERAGE ===');
console.log('Total companies:', db.prepare("SELECT COUNT(*) as c FROM companies").get().c);
console.log('Total emails:', db.prepare("SELECT COUNT(*) as c FROM email_records").get().c);
console.log('Main sent:', db.prepare("SELECT COUNT(*) as c FROM send_log").get().c);
console.log('SaaS sent:', db.prepare("SELECT COUNT(*) as c FROM send_log_saas").get().c);
console.log('');

// What domains are we covering?
const domains = db.prepare(`
  SELECT 
    CASE 
      WHEN website LIKE '%.ca' THEN 'Canada (.ca)'
      WHEN website LIKE '%.com' THEN 'USA (.com)'
      WHEN website LIKE '%.co.uk' THEN 'UK (.co.uk)'
      ELSE 'Other'
    END as region,
    COUNT(*) as c
  FROM companies 
  WHERE website IS NOT NULL AND website != ''
  GROUP BY region
  ORDER BY c DESC
`).all();
console.log('=== GEOGRAPHIC COVERAGE ===');
domains.forEach(d => console.log(`  ${d.region}: ${d.c}`));
console.log('');

// How many companies have NO email record?
const noEmail = db.prepare(`
  SELECT COUNT(*) as c FROM companies c 
  WHERE NOT EXISTS (SELECT 1 FROM email_records e WHERE e.business_id = c.business_id)
`).get().c;
console.log('=== EMAIL GAP ===');
console.log('Companies WITHOUT email:', noEmail);
console.log('Companies WITH email:', db.prepare("SELECT COUNT(DISTINCT business_id) as c FROM email_records").get().c);
console.log('Email conversion rate:', ((2529 - noEmail) / 2529 * 100).toFixed(1) + '%');
