import https from 'https';
import { URL } from 'url';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, 'data', 'canada.db');

const AJAX_URL = 'https://chamber.ca/wp-admin/admin-ajax.php';

function defaultLogger(msg) {
  console.log(msg);
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');
}

function postForm(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = body;
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36',
        'Accept': '*/*', 'Accept-Language': 'en-CA,en;q=0.9',
      }
    }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function parseCards(html) {
  const cards = [];
  const blocks = html.split('<div class="relative my-5">').slice(1);
  for (const block of blocks) {
    const nameM = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!nameM) continue;
    let name = decodeEntities(nameM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    if (name.length < 2 || name.length > 120) continue;
    let website = null;
    const siteM = block.match(/href="(https?:\/\/[^"]+)"/);
    if (siteM) website = siteM[1];
    let city = '';
    const locM = block.match(/Location Icon[\s\S]*?<[^>]*>\s*([^<]+?)\s*</);
    if (locM) city = decodeEntities(locM[1]).trim();
    cards.push({ name, website, city });
  }
  return cards;
}

// Filtre gruplari: her biri ayri istek seti olusturur (hedef: IT agirlikli + tumu)
// IT sektor kodlari (get_hubspot_industries'ten derlenen)
const IT_INDUSTRIES = [
  'INFORMATION_TECHNOLOGY', 'INFORMATION_TECHNOLOGY_SERVICES', 'COMPUTER_SOFTWARE',
  'COMPUTER_NETWORKING', 'COMPUTER_HARDWARE', 'INTERNET', 'TELECOMMUNICATIONS',
  'SECURITY_INVESTIGATIONS', 'MANAGED_SERVICES', 'DATABASE', 'CYBER_SECURITY'
];

export async function sweepChamberToDatabase({
  db: externalDb = null,
  maxPages = 30,
  logger = defaultLogger,
  modes = ['corporate', 'association', 'it'] // it = IT sektorlu corporate
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(defaultDbPath);
  let totalImported = 0;
  let pagesScanned = 0;

  logger('[CHAMBER] Starting Canadian Chamber business directory sweep...');

  try {
    for (const mode of modes) {
      const baseParams = new URLSearchParams();
      baseParams.set('action', 'get_chamber_companies');
      baseParams.set('membership_type', mode === 'association' ? 'Association' : 'Corporate');
      baseParams.set('search', '');
      baseParams.set('searchKey', '');
      if (mode === 'it') {
        for (const ind of IT_INDUSTRIES) baseParams.append('industry[]', ind);
      }

      let page = 1;
      while (page <= maxPages) {
        baseParams.set('page', String(page));
        const body = baseParams.toString();
        logger(`[CHAMBER] ${mode} / page ${page}...`);
        pagesScanned++;

        const res = await postForm(AJAX_URL, body);
        if (res.status !== 200) { logger(`[CHAMBER] HTTP ${res.status}. Stopping ${mode}.`); break; }
        let json;
        try { json = JSON.parse(res.body); } catch { logger('[CHAMBER] JSON parse fail. Stopping ' + mode); break; }
        if (!json.success || !json.data) { logger('[CHAMBER] API no-data. Stopping ' + mode); break; }

        const cards = parseCards(json.data.html || '');
        if (cards.length === 0) { logger(`[CHAMBER] ${mode}: no entries. Ending.`); break; }

        let inserted = 0;
        for (const { name, website, city } of cards) {
          const businessId = 'CHAMBER-' + Buffer.from(name + city).toString('hex').slice(0, 16);
          try {
            const stmt = db.prepare('INSERT OR IGNORE INTO companies (business_id, company_name, website) VALUES (?, ?, ?)');
            const r = stmt.run(businessId, name, website || null);
            if (r.changes > 0) { totalImported++; inserted++; }
          } catch {}
        }
        logger(`[CHAMBER] ${mode} page ${page}: Found ${cards.length}, New: ${inserted}`);

        const limit = json.data.limit || 20;
        if (cards.length < limit) break;
        if (page >= maxPages) break;
        page++;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  } catch (err) {
    logger(`[CHAMBER] Fatal error during sweep: ${err.message}`);
  } finally {
    if (ownDb) db.close();
  }

  logger(`[CHAMBER] Sweep complete. New companies imported: ${totalImported}`);
  return { totalImported, pagesProcessed: pagesScanned };
}

async function runStandalone() {
  try {
    await sweepChamberToDatabase();
  } catch (err) { console.error('[CHAMBER] Fatal error:', err.message); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone();
}