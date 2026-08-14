// Email extraction and classification
import { normalizeEmail } from './email-utils.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const CLASSIFICATION_RULES = [
  { type: 'hr', patterns: ['hr', 'rh', 'ressourceshumaines', 'humanresources', 'talent'] },
  { type: 'recruitment', patterns: ['recruitment', 'recrutement', 'careers', 'carrieres', 'jobs', 'emplois'] },
  { type: 'management', patterns: ['ceo', 'cto', 'cfo', 'director', 'directeur', 'management'] },
  { type: 'info', patterns: ['^info$'] },
  { type: 'contact', patterns: ['contact', 'hello', 'bonjour'] },
];

const OBFUSCATIONS = [
  { p: /\s*[\(\[]at[\)\]]\s*/gi, r: '@' },
  { p: /\s*@\s*/g, r: '@' },
  { p: /\s*[\(\[]dot[\)\]]\s*/gi, r: '.' },
];

export function extractEmails(html) {
  if (!html) return [];
  
  // De-obfuscate common patterns
  let cleanText = html;
  for (const obs of OBFUSCATIONS) {
    cleanText = cleanText.replace(obs.p, obs.r);
  }

  // URL-decode common encoded characters
  cleanText = cleanText.replace(/%20/g, ' ').replace(/%40/g, '@').replace(/%2E/gi, '.');

  // Strip mailto: and email: prefixes so the regex can pick up the clean email
  cleanText = cleanText.replace(/mailto:/gi, '').replace(/\bemail:/gi, '');

  // Strip HTML entity artifacts (e.g. \u003e from JSON-encoded HTML)
  cleanText = cleanText.replace(/u003e/gi, '');

  const matches = cleanText.match(EMAIL_REGEX) || [];
  
  const normalizedMatches = matches
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  
  const BLACKLIST_LOCAL = [
    'div', 'span', 'class', 'id', 'click', 'keyup', 'keydown', 'keypress', 'scroll', 'focus', 'blur', 'submit', 'change', 'hover', 'active', 'btn', 'nav', 'container', 'wrapper',
    'firstname', 'lastname', 'yourname', 'testname', 'name.surname', 'john.doe', 'forename', 'surname', 'postmaster', 'prenom', 'nom', 'prenom.nom',
    'error-lite', 'noreply', 'no-reply', 'mailer-daemon', 'donotreply'
  ];
  const BLACKLIST_DOMAINS = [
    'keyup.escape.window', 'click.away', 'scroll.away', 'focus.out', 'blur.out',
    'duckduckgo.com', 'google.com', 'startpage.com', 'bing.com', 'yahoo.com',
    'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
    'youtube.com', 'reddit.com', 'pinterest.com', 'wikipedia.org'
  ];

  // Deduplicate case-insensitive
  const seen = new Set();

  // Valid TLDs — reject anything that isn't a real TLD (e.g. .webp, .png, .jpg used in img srcsets)
  const MEDIA_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'avif',
    'mp4', 'mp3', 'wav', 'pdf', 'zip', 'tar', 'gz', 'css', 'js', 'ts', 'json',
    'xml', 'csv', 'xlsx', 'docx', 'pptx', 'woff', 'woff2', 'ttf', 'eot'
  ]);

  return normalizedMatches.filter(email => {
    const lower = email.toLowerCase().trim();
    if (seen.has(lower)) return false;
    
    const [local, domain] = lower.split('@');
    if (!local || !domain) return false;

    // Reject if TLD is a media/asset extension (e.g. intersection-49@2x-768x329.webp)
    const tld = domain.split('.').pop();
    if (MEDIA_EXTENSIONS.has(tld)) return false;

    // Reject domain containing image dimension patterns like 768x329 or 1024x768
    if (/\d+x\d+/.test(domain)) return false;
    
    // Filter out suspicious numeric prefixes (e.g. 400info, 123contact) - these are often scraping artifacts
    if (/^\d{3,}/.test(local) && local.length < 10) return false;
    
    // Filter out 1-letter local parts (usually garbage like o@, s@, n@)
    if (local.length < 2) return false;
    
    // Filter out broken/invalid emails
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
        local.includes(' ') || local.includes('%') ||
        domain.startsWith('.') || domain.includes('..') ||
        domain.length < 4) {
      return false;
    }

    // Reject exact placeholder matches
    if (local === 'firstname.lastname' || local === 'prenom.nom' ||
        local === 'forename.surname' || local === 'first.last' ||
        local === 'name.surname' || local === 'your.name') {
      return false;
    }
    
    // Filter out blacklisted local parts or specific false-positive domains
    if (BLACKLIST_LOCAL.some(bl => local === bl || local === `${bl}.${bl}`) || 
        BLACKLIST_DOMAINS.some(d => domain.includes(d)) || 
        domain.endsWith('.window') || 
        domain.endsWith('.location') ||
        domain.endsWith('.escape') ||
        domain.endsWith('.navigator') ||
        domain.includes('localhost')) {
      return false;
    }

    // Filter out common asset false positives or generic placeholders
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.gif') ||
        lower.endsWith('.svg') || lower.endsWith('.css') || lower.endsWith('.js') ||
        lower.includes('example.com') || lower.includes('sentry.io') ||
        lower.includes('webpack') || lower.includes('wixpress') ||
        lower.includes('github.com') || lower.includes('test.com') ||
        domain === 'mail.com' || domain === 'email.com' || domain === 'placeholder.com' ||
        domain === 'cloud.com' || domain === 'domain.com' ||
        local === 'user' || local === 'admin' || local === 'test' ||
        local === 'skyhigh' || local === 'dummy' || local === 'name' ||
        local === 'email' || local === 'username') {
      return false;
    }
    
    seen.add(lower);
    return true;
  });
}

export function classifyEmail(email) {
  const localPart = email.split('@')[0].toLowerCase();
  
  for (const rule of CLASSIFICATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.startsWith('^') && pattern.endsWith('$')) {
        // Exact match
        if (localPart === pattern.slice(1, -1)) return rule.type;
      } else {
        if (localPart.includes(pattern)) return rule.type;
      }
    }
  }
  
  return 'general';
}

export function deduplicateRecords(records) {
  const SOURCE_PRIORITY = { website: 0, google_dork: 1, linkedin: 2 };
  const groups = new Map();
  
  for (const record of records) {
    const key = `${record.business_id}|${record.email.toLowerCase()}`;
    const existing = groups.get(key);
    
    if (!existing || (SOURCE_PRIORITY[record.source] || 99) < (SOURCE_PRIORITY[existing.source] || 99)) {
      groups.set(key, record);
    }
  }
  
  return Array.from(groups.values());
}
