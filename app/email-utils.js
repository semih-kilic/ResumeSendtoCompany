/**
 * Normalize scraped or stored email addresses (fixes %20 artifacts, mailto:, etc.)
 */
export function normalizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let email = raw.trim().toLowerCase();
  try {
    email = decodeURIComponent(email);
  } catch {
    // keep partially decoded string
  }

  email = email
    .replace(/^mailto:/, '')
    .replace(/^email:/, '')
    .replace(/\s+/g, '')
    .replace(/^%20+/, '')
    .replace(/%20/g, '')
    .replace(/%40/g, '@');

  if (!email.includes('@')) return null;
  return email;
}

export function isValidEmailForSend(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized.includes(' ') || normalized.includes('%')) return false;
  if (normalized.startsWith('.') || normalized.includes('..')) return false;

  const [local, domain] = normalized.split('@');
  if (!local || !domain || local.length < 2) return false;

  return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(normalized);
}
