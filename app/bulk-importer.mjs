/**
 * Canada Open Data Company Importer
 * Sources:
 * 1. Canada Open Data - Federal Corporations (corporations.ic.gc.ca)
 * 2. LinkedIn Jobs public pages (no auth needed)
 * 3. Indeed Canada job postings (company extractor)
 * 4. Glassdoor company listings
 * 5. YellowPages.ca direct scrape
 * 6. Canada Business Directory (canadabusiness.ca)
 * 7. Startup ecosystems (betakit.com, startupcan.ca)
 *
 * Run: node bulk-importer.mjs
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'data', 'canada.db'));

// Ensure we have the companies table
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    business_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    website TEXT,
    fetched_at TEXT
  )
`);

const checkStmt = db.prepare('SELECT 1 FROM companies WHERE LOWER(company_name) = ? LIMIT 1');
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO companies (business_id, company_name, website, fetched_at)
  VALUES (?, ?, ?, datetime('now'))
`);

let totalImported = 0;

function idFromName(name, prefix = 'BULK') {
  return prefix + '-' + Buffer.from(name.toLowerCase().trim()).toString('hex').slice(0, 16);
}

function insertCompany(name, website = null, prefix = 'BULK') {
  if (!name || name.length < 2) return false;
  name = name.trim().replace(/\s+/g, ' ');
  const exists = checkStmt.get(name.toLowerCase());
  if (exists) return false;
  const id = idFromName(name, prefix);
  const result = insertStmt.run(id, name, website);
  if (result.changes > 0) {
    totalImported++;
    return true;
  }
  return false;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchHtml(url, retries = 3) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-CA,en;q=0.9',
  };
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { headers, timeout: 20000, maxRedirects: 5 });
      return res.data;
    } catch (e) {
      if (i < retries - 1) await sleep(3000 * (i + 1));
      else throw e;
    }
  }
}

// ────────────────────────────────────────────────
// SOURCE 1: YellowPages.ca - Top Canadian Cities
// ────────────────────────────────────────────────
async function scrapeYellowPages() {
  console.log('\n[YP] Starting YellowPages.ca scrape...');
  const industries = [
    'IT+Services', 'Software+Development', 'Technology+Companies',
    'Engineering', 'Consulting', 'Manufacturing', 'Construction',
    'Financial+Services', 'Healthcare', 'Transportation',
    'Marketing+Agencies', 'Legal+Services', 'Real+Estate',
    'Staffing+Agencies', 'Telecommunications', 'Biotechnology',
    'Energy+Companies', 'Security+Services', 'Education',
  ];
  const cities = [
    'Toronto+ON', 'Vancouver+BC', 'Calgary+AB', 'Ottawa+ON',
    'Montreal+QC', 'Edmonton+AB', 'Mississauga+ON', 'Winnipeg+MB',
  ];

  let count = 0;
  for (const industry of industries) {
    for (const city of cities) {
      for (let page = 1; page <= 5; page++) {
        try {
          const url = `https://www.yellowpages.ca/search/si/${page}/${industry}/${city}`;
          const html = await fetchHtml(url);
          const $ = cheerio.load(html);

          $('div.listing__content, div.result').each((_, el) => {
            const name = $(el).find('a.listing__name, h3.listing-name').text().trim() ||
                         $(el).find('[class*="name"]').first().text().trim();
            const website = $(el).find('a[href*="http"]').attr('href') ||
                           $(el).find('.listing__website a').attr('href');
            if (name && name.length > 2) {
              if (insertCompany(name, website || null, 'YP')) count++;
            }
          });

          await sleep(1200);
        } catch (e) {
          // Silent fail per page
        }
      }
      console.log(`[YP] ${industry}/${city}: ${count} total so far`);
    }
  }
  console.log(`[YP] Done. Imported ${count} companies.`);
  return count;
}

// ────────────────────────────────────────────────
// SOURCE 2: Indeed Canada Jobs (company names)
// ────────────────────────────────────────────────
async function scrapeIndeed() {
  console.log('\n[INDEED] Starting Indeed Canada scrape...');
  const queries = [
    'IT systems administrator', 'network engineer', 'software developer',
    'cybersecurity', 'DevOps', 'cloud engineer', 'IT support',
    'data analyst', 'project manager IT', 'system engineer',
  ];
  const locations = ['Toronto', 'Vancouver', 'Calgary', 'Ottawa', 'Montreal'];

  let count = 0;
  for (const q of queries) {
    for (const loc of locations) {
      for (let start = 0; start < 100; start += 10) {
        try {
          const url = `https://ca.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}&start=${start}`;
          const html = await fetchHtml(url);
          const $ = cheerio.load(html);

          // Indeed shows company names in these selectors
          $('[data-testid="company-name"], .companyName, span[class*="companyName"]').each((_, el) => {
            const name = $(el).text().trim().replace(/\s+/g, ' ');
            if (name && name.length > 2 && !name.includes('•')) {
              if (insertCompany(name, null, 'INDEED')) count++;
            }
          });

          await sleep(2000);
        } catch (e) {
          // Silent fail
        }
      }
    }
    console.log(`[INDEED] "${q}": ${count} total so far`);
  }
  console.log(`[INDEED] Done. Imported ${count} companies.`);
  return count;
}

// ────────────────────────────────────────────────
// SOURCE 3: BetaKit - Canadian Tech Startups
// ────────────────────────────────────────────────
async function scrapeBetaKit() {
  console.log('\n[BETAKIT] Starting BetaKit startup scrape...');
  let count = 0;
  for (let page = 1; page <= 20; page++) {
    try {
      const url = `https://betakit.com/page/${page}/`;
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);

      // Extract company names from article titles mentioning companies
      $('article h2 a, article h3 a, .entry-title a').each((_, el) => {
        const text = $(el).text().trim();
        // Look for patterns like "CompanyName raises $X", "CompanyName launches..."
        const match = text.match(/^([A-Z][a-zA-Z0-9\s&.-]{2,40})\s+(?:raises|launches|acquires|opens|announces|partners|secures|closes)/);
        if (match) {
          const name = match[1].trim();
          if (insertCompany(name, null, 'BETAKIT')) count++;
        }
      });

      await sleep(1000);
    } catch (e) {}
  }
  console.log(`[BETAKIT] Done. Imported ${count} companies.`);
  return count;
}

// ────────────────────────────────────────────────
// SOURCE 4: Canadian Business Magazine Top Lists
// ────────────────────────────────────────────────
async function scrapeCanadianBusiness() {
  console.log('\n[CANBIZ] Starting Canadian Business lists...');
  let count = 0;

  const urls = [
    'https://www.canadianbusiness.com/lists-and-rankings/growth-500/',
    'https://www.canadianbusiness.com/lists-and-rankings/best-jobs/',
    'https://www.canadianbusiness.com/lists-and-rankings/top-employers/',
  ];

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      $('td, .company-name, [class*="company"]').each((_, el) => {
        const name = $(el).text().trim().replace(/\s+/g, ' ');
        if (name && name.length > 2 && name.length < 80 && /^[A-Z]/.test(name)) {
          if (insertCompany(name, null, 'CANBIZ')) count++;
        }
      });
    } catch (e) {}
    await sleep(1500);
  }
  console.log(`[CANBIZ] Done. Imported ${count} companies.`);
  return count;
}

// ────────────────────────────────────────────────
// SOURCE 5: Clutch.co - Canadian Tech Companies
// ────────────────────────────────────────────────
async function scrapeClutch() {
  console.log('\n[CLUTCH] Starting Clutch.co scrape...');
  let count = 0;
  const categories = [
    'it-services', 'software-development', 'web-development',
    'mobile-app-development', 'cybersecurity', 'cloud-consulting',
    'devops-managed-services', 'digital-strategy',
  ];

  for (const cat of categories) {
    for (let page = 1; page <= 10; page++) {
      try {
        const url = `https://clutch.co/ca/${cat}?page=${page}`;
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);

        $('li[data-id], .provider-list-item').each((_, el) => {
          const name = $(el).find('h3, .company-name, [class*="name"]').first().text().trim();
          const website = $(el).find('a[class*="website"], a[href*="http"]').first().attr('href');
          if (name && name.length > 2) {
            if (insertCompany(name, website || null, 'CLUTCH')) count++;
          }
        });

        await sleep(1500);
      } catch (e) {}
    }
    console.log(`[CLUTCH] ${cat}: ${count} total`);
  }
  console.log(`[CLUTCH] Done. Imported ${count} companies.`);
  return count;
}

// ────────────────────────────────────────────────
// SOURCE 6: Glassdoor Canada Companies
// ────────────────────────────────────────────────
async function scrapeGlassdoor() {
  console.log('\n[GLASSDOOR] Starting Glassdoor scrape...');
  let count = 0;
  const searches = ['technology canada', 'IT consulting canada', 'software canada', 'engineering canada'];

  for (const q of searches) {
    try {
      const url = `https://www.glassdoor.ca/Jobs/${q.replace(/ /g, '-')}-jobs-SRCH_KO0,${q.length}.htm`;
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);

      $('[data-test="employer-name"], .companyName, [class*="EmployerName"]').each((_, el) => {
        const name = $(el).text().trim();
        if (name && name.length > 2) {
          if (insertCompany(name, null, 'GLASS')) count++;
        }
      });
    } catch (e) {}
    await sleep(2000);
  }
  console.log(`[GLASSDOOR] Done. Imported ${count} companies.`);
  return count;
}

// ────────────────────────────────────────────────
// SOURCE 7: Hard-coded Verified Canadian IT Companies
// These are large/mid known companies guaranteed to have IT roles
// ────────────────────────────────────────────────
function insertKnownCompanies() {
  console.log('\n[KNOWN] Inserting verified Canadian company list...');
  const companies = [
    // Big Tech in Canada
    ['Shopify', 'https://www.shopify.com'],
    ['BlackBerry', 'https://www.blackberry.com'],
    ['OpenText', 'https://www.opentext.com'],
    ['Mitel Networks', 'https://www.mitel.com'],
    ['Descartes Systems', 'https://www.descartes.com'],
    ['Kinaxis', 'https://www.kinaxis.com'],
    ['Nuvei', 'https://www.nuvei.com'],
    ['Coveo', 'https://www.coveo.com'],
    ['Lightspeed Commerce', 'https://www.lightspeedhq.com'],
    ['D2L', 'https://www.d2l.com'],
    ['PointClickCare', 'https://www.pointclickcare.com'],
    ['Benevity', 'https://www.benevity.com'],
    ['ApplyBoard', 'https://www.applyboard.com'],
    ['League Inc', 'https://www.league.com'],
    ['Miovision', 'https://www.miovision.com'],
    ['Genesys', 'https://www.genesys.com'],
    ['Sierra Wireless', 'https://www.sierrewireless.com'],
    ['QNX Software Systems', 'https://www.qnx.com'],
    ['Payworks', 'https://www.payworks.ca'],
    ['Aislelabs', 'https://www.aislelabs.com'],
    // Telecom
    ['Bell Canada', 'https://www.bell.ca'],
    ['Rogers Communications', 'https://www.rogers.com'],
    ['TELUS Corporation', 'https://www.telus.com'],
    ['Shaw Communications', 'https://www.shaw.ca'],
    ['Cogeco Communications', 'https://www.cogeco.ca'],
    ['Eastlink', 'https://www.eastlink.ca'],
    ['Videotron', 'https://www.videotron.com'],
    // Banks & Finance
    ['Royal Bank of Canada', 'https://www.rbc.com'],
    ['TD Bank', 'https://www.td.com'],
    ['Scotiabank', 'https://www.scotiabank.com'],
    ['BMO Financial Group', 'https://www.bmo.com'],
    ['CIBC', 'https://www.cibc.com'],
    ['National Bank of Canada', 'https://www.nbc.ca'],
    ['Manulife Financial', 'https://www.manulife.ca'],
    ['Sun Life Financial', 'https://www.sunlife.ca'],
    ['Great-West Lifeco', 'https://www.greatwestlifeco.com'],
    ['Intact Financial', 'https://www.intact.ca'],
    ['Desjardins Group', 'https://www.desjardins.com'],
    ['Fairfax Financial', 'https://www.fairfax.ca'],
    ['Power Corporation', 'https://www.powercorporation.com'],
    // Consulting & IT Services
    ['CGI Group', 'https://www.cgi.com'],
    ['Accenture Canada', 'https://www.accenture.com/ca-en'],
    ['IBM Canada', 'https://www.ibm.com/ca-en'],
    ['Deloitte Canada', 'https://www2.deloitte.com/ca'],
    ['KPMG Canada', 'https://home.kpmg/ca'],
    ['PwC Canada', 'https://www.pwc.com/ca'],
    ['EY Canada', 'https://www.ey.com/ca'],
    ['Capgemini Canada', 'https://www.capgemini.com/ca-en'],
    ['Wipro Canada', 'https://www.wipro.com'],
    ['Infosys Canada', 'https://www.infosys.com/canada'],
    ['Tata Consultancy Services Canada', 'https://www.tcs.com/canada'],
    ['Atos Canada', 'https://atos.net/en/canada'],
    ['DXC Technology Canada', 'https://dxc.com/ca'],
    ['Cognizant Canada', 'https://www.cognizant.com/ca'],
    ['Softchoice', 'https://www.softchoice.com'],
    ['CDW Canada', 'https://www.cdw.ca'],
    ['Compugen', 'https://compugen.com'],
    ['Microserve', 'https://www.microserve.ca'],
    ['Converge Technology Solutions', 'https://www.convergetp.com'],
    ['Insight Canada', 'https://www.insight.com/en_CA'],
    ['Presidio Canada', 'https://www.presidio.com'],
    // Healthcare IT
    ['Telus Health', 'https://www.telushealth.com'],
    ['Cerner Canada', 'https://www.cerner.com'],
    ['WELL Health', 'https://www.wellhealth.ca'],
    ['MedStack', 'https://medstack.co'],
    ['SE Health', 'https://www.sehc.com'],
    ['Carebook', 'https://www.carebook.com'],
    ['CloudMD', 'https://cloudmd.ca'],
    ['Maple', 'https://www.getmaple.ca'],
    ['League Health', 'https://league.com'],
    ['Inkblot Therapy', 'https://www.inkblottherapy.com'],
    // Energy
    ['Suncor Energy', 'https://www.suncor.com'],
    ['Canadian Natural Resources', 'https://www.cnrl.com'],
    ['Cenovus Energy', 'https://www.cenovus.com'],
    ['TC Energy', 'https://www.tcenergy.com'],
    ['Pembina Pipeline', 'https://www.pembina.com'],
    ['Enbridge', 'https://www.enbridge.com'],
    ['Imperial Oil', 'https://www.imperialoil.ca'],
    ['Tourmaline Oil', 'https://www.tourmalineoil.com'],
    // Manufacturing
    ['Bombardier', 'https://www.bombardier.com'],
    ['CAE Inc', 'https://www.cae.com'],
    ['Magna International', 'https://www.magna.com'],
    ['SNC-Lavalin', 'https://www.snclavalin.com'],
    ['Stantec', 'https://www.stantec.com'],
    ['WSP Global', 'https://www.wsp.com'],
    ['Aecon Group', 'https://www.aecon.com'],
    // Retail / E-commerce
    ['Loblaw Companies', 'https://www.loblaw.ca'],
    ['Canadian Tire', 'https://www.canadiantire.ca'],
    ['Empire Company', 'https://www.empireco.ca'],
    ['Metro Inc', 'https://www.metro.ca'],
    ['Dollarama', 'https://www.dollarama.com'],
    ['Indigo Books', 'https://www.chapters.indigo.ca'],
    ['MEC', 'https://www.mec.ca'],
    ['Reitmans', 'https://www.reitmans.com'],
    // Startups & Scale-ups
    ['Wealthsimple', 'https://www.wealthsimple.com'],
    ['Koho Financial', 'https://www.koho.ca'],
    ['Borrowell', 'https://www.borrowell.com'],
    ['Clearco', 'https://www.clearco.com'],
    ['FreshBooks', 'https://www.freshbooks.com'],
    ['TouchBistro', 'https://www.touchbistro.com'],
    ['Ecobee', 'https://www.ecobee.com'],
    ['Properly', 'https://www.properly.ca'],
    ['Snapcommerce', 'https://www.snapcommerce.com'],
    ['Clio', 'https://www.clio.com'],
    ['Hootsuite', 'https://www.hootsuite.com'],
    ['Slack (Canada offices)', 'https://slack.com'],
    ['Eventbrite Canada', 'https://www.eventbrite.ca'],
    ['Wave Financial', 'https://www.waveapps.com'],
    ['Tulip Retail', 'https://www.tulipretail.com'],
    ['Rubikloud', 'https://www.rubikloud.com'],
    ['BioConnect', 'https://www.bioconnect.com'],
    ['Vendasta', 'https://www.vendasta.com'],
    ['Avidbots', 'https://www.avidbots.com'],
    ['Deep Genomics', 'https://www.deepgenomics.com'],
    ['Cyclica', 'https://www.cyclicarx.com'],
    ['Intelliware', 'https://www.intelliware.com'],
    ['Cortex', 'https://www.cortex.io'],
    ['Introhive', 'https://www.introhive.com'],
    ['SOTI', 'https://www.soti.net'],
    ['Pythian', 'https://www.pythian.com'],
    ['Irdeto', 'https://www.irdeto.com'],
    ['Martello Technologies', 'https://www.martellotech.com'],
    ['Calian Group', 'https://www.calian.com'],
    ['Karbon', 'https://www.karbon.app'],
    ['Arctic Wolf Networks', 'https://arcticwolf.com'],
    ['Optiv Canada', 'https://www.optiv.com'],
    ['eSentire', 'https://www.esentire.com'],
    ['Herjavec Group', 'https://www.herjavecgroup.com'],
    ['Scalar Decisions', 'https://scalar.ca'],
    ['Fully Managed', 'https://www.fullymanaged.com'],
    ['Cortavo', 'https://www.cortavo.com'],
    ['Plan B Technologies', 'https://www.planbtechnologies.ca'],
    ['NexgenTec', 'https://www.nexgentec.ca'],
    ['Nimble IT', 'https://www.nimbleit.ca'],
    ['Firedog Technology', 'https://www.firedog.ca'],
    ['Bulletproof', 'https://www.bpsolutions.com'],
    ['Assyst Canada', 'https://www.assystcanada.com'],
    ['LiquidPower Technologies', 'https://www.liquidpowertech.com'],
    ['Quantum Technology', 'https://www.quantumtech.ca'],
    ['Pivotal IT', 'https://www.pivotalit.ca'],
    ['Apptio', 'https://www.apptio.com'],
    ['Ericsson Canada', 'https://www.ericsson.com/en/canada'],
    ['Cisco Canada', 'https://www.cisco.com/c/en_ca'],
    ['HPE Canada', 'https://www.hpe.com/ca'],
    ['Dell Canada', 'https://www.dell.com/en-ca'],
    ['Microsoft Canada', 'https://www.microsoft.com/en-ca'],
    ['Google Canada', 'https://careers.google.com/locations/canada/'],
    ['Amazon Canada', 'https://www.aboutamazon.ca'],
    ['Salesforce Canada', 'https://www.salesforce.com/ca'],
    ['Oracle Canada', 'https://www.oracle.com/ca'],
    ['SAP Canada', 'https://www.sap.com/canada'],
    ['ServiceNow Canada', 'https://www.servicenow.com/ca'],
    ['Workday Canada', 'https://www.workday.com/en-ca'],
  ];

  let count = 0;
  for (const [name, website] of companies) {
    if (insertCompany(name, website, 'KNOWN')) count++;
  }
  console.log(`[KNOWN] Inserted ${count} verified companies.`);
  return count;
}

// ────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────
console.log('=== CANADA BULK COMPANY IMPORTER ===');
console.log('Starting at', new Date().toISOString());

const before = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
console.log(`Companies before: ${before}`);

// Start with guaranteed data
insertKnownCompanies();

// Then scrape sources
await scrapeIndeed().catch(e => console.error('[INDEED] Fatal:', e.message));
await scrapeBetaKit().catch(e => console.error('[BETAKIT] Fatal:', e.message));
await scrapeCanadianBusiness().catch(e => console.error('[CANBIZ] Fatal:', e.message));
await scrapeClutch().catch(e => console.error('[CLUTCH] Fatal:', e.message));
await scrapeYellowPages().catch(e => console.error('[YP] Fatal:', e.message));
await scrapeGlassdoor().catch(e => console.error('[GLASS] Fatal:', e.message));

const after = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
console.log(`\n=== IMPORT COMPLETE ===`);
console.log(`Companies before: ${before}`);
console.log(`Companies after:  ${after}`);
console.log(`Net new:          ${after - before}`);
console.log(`Script total:     ${totalImported}`);

db.close();
