import puppeteer from 'puppeteer';
import { insertCompany } from './db.js';
import fs from 'fs';
import path from 'path';

// OMEGA Maps Stealth Importer
// Bu script, Google Maps üzerinden yerel IT/SaaS firmalarını bulur.

const MAPS_CATEGORIES = [
  'cybersecurity company',
  'IT services',
  'software company',
  'managed IT provider',
  'technology consulting'
];

const MAPS_CITIES = [
  'Toronto, ON', 'Vancouver, BC', 'Montreal, QC', 'Calgary, AB', 'Ottawa, ON',
  'Mississauga, ON', 'Edmonton, AB', 'Winnipeg, MB', 'Victoria, BC', 'Halifax, NS'
];

async function scrollSidebar(page) {
  try {
    let previousHeight = 0;
    let retries = 0;
    while (retries < 5) {
      // Google Maps sidebar scroll element is usually 'div[role="feed"]'
      const newHeight = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          feed.scrollTo(0, feed.scrollHeight);
          return feed.scrollHeight;
        }
        return 0;
      });
      if (newHeight === previousHeight) {
        retries++;
      } else {
        retries = 0;
        previousHeight = newHeight;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    // silently fail scroll
  }
}

export async function sweepMapsToDatabase({ db, logger }) {
  const log = (level, message) => {
    if (logger) logger(`[MAPS] [${level.toUpperCase()}] ${message}`);
    console.log(`[MAPS] [${level.toUpperCase()}] ${message}`);
  };

  const statePath = path.join(process.cwd(), 'data', 'maps_sync.json');
  let state = { lastCityIndex: 0, lastCategoryIndex: 0, lastRun: 0 };
  if (fs.existsSync(statePath)) {
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
  }

  // Sadece günde 1 kez derinlemesine kazıma yap (6 saatte bir tetiklenir ama maps yavaştır)
  if (Date.now() - state.lastRun < 12 * 60 * 60 * 1000) {
    log('info', 'Maps sweep is on cooldown. Skipping.');
    return;
  }

  log('info', 'Booting up Puppeteer stealth engine for Google Maps...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true, // "new" headless is the default now in v22+
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let category = MAPS_CATEGORIES[state.lastCategoryIndex];
    let city = MAPS_CITIES[state.lastCityIndex];

    const query = `${category} in ${city}`;
    log('info', `Searching Google Maps for: ${query}`);

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the results to load
    await new Promise(r => setTimeout(r, 5000));

    // Scroll to load lazy elements
    await scrollSidebar(page);

    // Extract companies and their websites
    const results = await page.evaluate(() => {
      const companies = [];
      // Grab all links
      const links = Array.from(document.querySelectorAll('a'));
      let _currentCompany = '';

      for (let el of links) {
        const href = el.href;
        const ariaLabel = el.getAttribute('aria-label') || '';
        
        // Google Maps uses aria-labels on links for place names
        // But the easiest way to get websites is looking for external links
        // However, since the DOM is complex, we will grab ALL valid external URLs
        // and associate them with the search query.
        
        if (href && href.startsWith('http') && !href.includes('google.com')) {
          companies.push({
            name: ariaLabel ? ariaLabel : 'Local IT Business',
            website: href.split('?')[0]
          });
        }
      }
      return companies;
    });

    // Deduplicate
    const uniqueWebsites = new Set();
    let imported = 0;

    for (const c of results) {
      if (uniqueWebsites.has(c.website)) continue;
      uniqueWebsites.add(c.website);

      // Clean website
      try {
        const url = new URL(c.website);
        if (url.hostname.includes('facebook') || url.hostname.includes('instagram') || url.hostname.includes('linkedin')) continue;
        
        // Clean name (if it's generic, create a fallback)
        const finalName = c.name !== 'Local IT Business' ? c.name : url.hostname.replace('www.', '').split('.')[0];
        
        insertCompany(db, finalName, url.origin, 'Google Maps');
        imported++;
      } catch (e) {}
    }

    log('info', `Successfully scraped ${imported} new companies from Google Maps.`);

    // Update state for next round
    state.lastCityIndex++;
    if (state.lastCityIndex >= MAPS_CITIES.length) {
      state.lastCityIndex = 0;
      state.lastCategoryIndex++;
      if (state.lastCategoryIndex >= MAPS_CATEGORIES.length) {
        state.lastCategoryIndex = 0;
      }
    }
    state.lastRun = Date.now();
    fs.writeFileSync(statePath, JSON.stringify(state));

  } catch (error) {
    log('error', `Puppeteer failed: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}
