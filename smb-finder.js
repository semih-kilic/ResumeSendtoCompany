import axios from 'axios';
import { insertCompany } from './db.js';

// ═══════════════════════════════════════════════════════════════════
// SMB Finder via limit-break gateway
// Uses TLS impersonation to bypass anti-bot
// ═══════════════════════════════════════════════════════════════════

const SMB_CATEGORIES = [
  'restaurant', 'cafe', 'bakery', 'dentist', 'plumber', 'electrician',
  'real estate agency', 'auto repair', 'gym', 'salon', 'spa',
  'law office', 'accounting firm', 'insurance agency', 'travel agency',
  'hotel', 'pet store', 'veterinary', 'pharmacy',
  'grocery store', 'clothing store', 'furniture store', 'hardware store',
  'moving company', 'cleaning service', 'landscaping', 'roofing',
  'HVAC', 'pest control', 'locksmith',
  'daycare', 'tutoring', 'music school',
  'medical clinic', 'dental clinic', 'physiotherapy', 'chiropractor',
  'optometrist', 'coffee shop', 'pizza place', 'sushi restaurant',
  'bar', 'brewery', 'car dealership', 'body shop',
  'bank', 'credit union', 'financial advisor',
  'coworking space', 'storage facility',
];

const CANADIAN_CITIES = [
  'Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Edmonton', 'Ottawa',
  'Mississauga', 'Brampton', 'Hamilton', 'Kitchener', 'Winnipeg',
  'Halifax', 'Victoria', 'Saskatoon', 'Regina', 'Quebec City',
  'Kelowna', 'Barrie', 'Oshawa', 'Sudbury', 'Kingston',
];

const US_CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
  'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
  'Fort Worth', 'Columbus', 'Charlotte', 'Indianapolis', 'San Francisco',
  'Seattle', 'Denver', 'Washington DC', 'Nashville', 'Oklahoma City',
  'Boston', 'Portland', 'Las Vegas', 'Memphis', 'Louisville',
  'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson', 'Fresno', 'Sacramento',
  'Mesa', 'Atlanta', 'Kansas City', 'Colorado Springs', 'Omaha', 'Raleigh',
  'Miami', 'Tulsa', 'Tampa', 'New Orleans', 'Detroit',
];

async function fetchViaLimitBreak(url, limitbreakUrl, limitbreakKey) {
  try {
    const response = await axios.post(
      limitbreakUrl + '/v1/fetch',
      { url, use_proxy: true, timeout: 20, impersonate: null },
      {
        headers: { 'Content-Type': 'application/json', 'X-API-Key': limitbreakKey },
        timeout: 30000,
      }
    );
    if (response.data && response.data.status === 200) {
      return response.data.body;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function extractEmailsFromHTML(html) {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const raw = html.match(emailRegex) || [];
  const blocked = new Set([
    'example.com', 'email.com', 'domain.com', 'test.com',
    'sentry.io', 'wixpress.com', 'w3.org', 'schema.org',
    'googleapis.com', 'gstatic.com', 'facebook.com', 'twitter.com',
    'instagram.com', 'linkedin.com', 'youtube.com', 'yelp.com',
    'apple.com', 'microsoft.com', 'amazon.com',
  ]);
  return [...new Set(raw)].filter(e => {
    const domain = e.split('@')[1]?.toLowerCase();
    return domain && !blocked.has(domain) && !domain.endsWith('.png') && !domain.endsWith('.jpg');
  });
}

function extractCompanyNamesFromHTML(html) {
  const names = [];
  // Try to find business names from common patterns
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].replace(/[-|–—].*$/, '').trim();
    if (title.length > 2 && title.length < 80) names.push(title);
  }
  // Try og:site_name
  const ogMatch = html.match(/property="og:site_name"[^>]*content="([^"]+)"/i);
  if (ogMatch) names.push(ogMatch[1].trim());
  return names;
}

export async function sweepSMBToDatabase({ db, config, logger }) {
  const log = (level, message) => {
    if (logger) logger(`[SMB-FINDER] [${level.toUpperCase()}] ${message}`);
    console.log(`[SMB-FINDER] [${level.toUpperCase()}] ${message}`);
  };

  const limitbreakUrl = config.limitbreak_url || 'http://localhost:8080';
  const limitbreakKey = config.limitbreak_key || '';
  let imported = 0;

  // ═══════════════════════════════════════════════════════════════
  // Source 1: Bing Search — find business websites
  // ═══════════════════════════════════════════════════════════════
  log('info', 'Starting Bing SMB search via limit-break...');

  const allCities = [...CANADIAN_CITIES, ...US_CITIES];
  const searchCategories = SMB_CATEGORIES.slice(0, 25);

  for (const category of searchCategories) {
    for (const city of allCities.slice(0, 15)) {
      try {
        const query = `"${category}" "${city}" contact us site:.com OR site:.ca`;
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        const html = await fetchViaLimitBreak(searchUrl, limitbreakUrl, limitbreakKey);
        if (!html) continue;

        // Extract URLs from Bing results
        const urlMatches = html.match(/href="https?:\/\/(?!www\.bing|www\.microsoft|www\.msn|go\.microsoft)[^\s"<>]+/gi) || [];
        let found = 0;

        for (const urlMatch of urlMatches) {
          const url = urlMatch.replace(/^href="/i, '').split('?')[0];
          if (url.includes('facebook.com') || url.includes('instagram.com') || url.includes('twitter.com') || url.includes('yelp.com') || url.includes('yellowpages.com') || url.includes('wikipedia.org')) continue;

          try {
            const hostname = new URL(url).hostname.replace('www.', '');
            const name = hostname.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            insertCompany(db, name, url, 'SMB-Bing');
            found++;
            imported++;
          } catch (e) {}
        }

        if (found > 0) {
          log('info', `Bing "${category}" in ${city}: +${found} businesses`);
        }

        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
      } catch (e) {}
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Source 2: Direct website scraping — extract emails
  // ═══════════════════════════════════════════════════════════════
  log('info', 'Starting direct website email extraction via limit-break...');

  // Get companies without email records
  const companiesWithoutEmails = db.prepare(`
    SELECT c.business_id, c.company_name, c.website 
    FROM companies c 
    LEFT JOIN email_records e ON c.business_id = e.business_id 
    WHERE e.id IS NULL AND c.website IS NOT NULL AND c.website != ''
    LIMIT 100
  `).all();

  log('info', `Found ${companiesWithoutEmails.length} companies without email records`);

  for (const company of companiesWithoutEmails) {
    try {
      const html = await fetchViaLimitBreak(company.website, limitbreakUrl, limitbreakKey);
      if (!html) continue;

      const emails = extractEmailsFromHTML(html);
      if (emails.length > 0) {
        for (const email of emails) {
          try {
            const { insertEmailRecord } = await import('./db.js');
            insertEmailRecord(db, {
              business_id: company.business_id,
              company_name: company.company_name,
              email: email,
              email_type: 'website',
              source: 'smb-finder',
            });
            imported++;
          } catch (e) {}
        }
        log('info', `Found ${emails.length} emails for ${company.company_name}: ${emails.join(', ')}`);
      }

      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    } catch (e) {}
  }

  log('info', `SMB sweep complete. Total imported: ${imported}`);
  return { totalImported: imported };
}
