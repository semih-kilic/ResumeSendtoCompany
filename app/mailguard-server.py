#!/usr/bin/env python3
"""
MAILGUARD — Local 9-Layer Email Verification API
Listens on port 8001, provides /validate endpoint.
Uses only Python standard library (no external deps).
"""
import json
import re
import socket
import subprocess
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get('MAILGUARD_PORT', '8001'))

# ── Disposable email domains (partial list) ──────────────────────────
DISPOSABLE_DOMAINS = {
    'mailinator.com', '10minutemail.com', 'guerrillamail.com',
    'temp-mail.org', 'yopmail.com', 'getnada.com', 'maildrop.cc',
    'tempmail.net', 'mailtemp.info', 'fakeinbox.com', 'trashmail.com',
    '10minutemail.net', 'guerrillamailblock.com', 'pokemail.net',
    'spamgourmet.com', 'mailnull.com', 'mailinator2.com', 'tempail.com',
    'dispostable.com', 'mailinator3.com', 'temp-mail.ru', 'temp-mail.net',
    'fake-mail.org', 'zephyrlabs.net', 'maildrop.gen.tr', 'gecici.email',
    'gecicimail.com', 'sakmail.com', 'sakmail.net', 'tmailinator.com',
    'meltmail.com', 'owlymail.com', 'mailnesia.com', 'mail.tm',
    '10minutemail.gq', '10minutemail.cf', '10minutemail.ml',
}

# ── Free email providers ─────────────────────────────────────────────
FREE_PROVIDERS = {
    'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
    'outlook.com', 'outlook.live.com', 'aol.com', 'icloud.com', 'me.com',
    'live.com', 'live.co.uk', 'msn.com', 'btinternet.com', 'btopenworld.com',
    'virginmedia.com', 'talktalk.net', 'tiscali.co.uk', 'sbcglobal.net',
    'att.net', 'verizon.net', 'rocketmail.com', 'zoho.com', 'protonmail.com',
    'tutanota.com', 'yandex.com', 'yandex.ru', 'mail.com', 'email.com',
    'gmx.com', 'gmx.net', 'libero.it', 'tin.it', 'alice.it', 'tiscali.it',
    'orange.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'neuf.fr', 'bbox.fr',
    'web.de', 't-online.de', 'freenet.de', 'arcor.de', 'gMX.de',
    'naver.com', 'daum.net', 'nate.com', 'hanmail.net',
}

# ── Role-based / generic aliases ───────────────────────────────────────
GENERIC_ALIASES = {
    'contact', 'info', 'admin', 'office', 'sales', 'support', 'aspa',
    'toimisto', 'postbox', 'mail', 'viesti', 'yhteys', 'posti',
    'kirjaamo', 'hello', 'helo', 'noreply', 'no-reply', 'notifications',
    'team', 'service', 'help', 'feedback', 'press', 'partners',
}

RECRUITMENT_ALIASES = {
    'hr', 'careers', 'jobs', 'rekry', 'talent', 'recruitment',
    'recruiter', 'hiring', 'people', 'join', 'work',
}

# ── Professional email pattern ────────────────────────────────────────
PERSONAL_EMAIL_RE = re.compile(
    r'^([a-z\u00e4\u00f6\u00e50-9]{2,}\.[a-z\u00e4\u00f6\u00e50-9]{2,}|'
    r'[a-z\u00e4\u00f6\u00e50-9]{3,}|'
    r'[a-z0-9]{1}\.[a-z\u00e4\u00f6\u00e50-9]{2,}|'
    r'[a-z\u00e4\u00f6\u00e50-9]{2,}\.[a-z0-9]{1})(@|$)',
    re.IGNORECASE
)

# ── Syntax validation ─────────────────────────────────────────────────
EMAIL_RE = re.compile(
    r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
    r'(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$'
)

# ── Common typos ──────────────────────────────────────────────────────
COMMON_TYPOS = {
    'gamil.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmail.cm': 'gmail.com',
    'hotmial.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'hotmil.com': 'hotmail.com',
    'outloook.com': 'outlook.com',
    'outlok.com': 'outlook.com',
    'yahooo.com': 'yahoo.com',
    'yhaoo.com': 'yahoo.com',
    'yhoo.com': 'yahoo.com',
    'icloud.cmo': 'icloud.com',
    'icoud.com': 'icloud.com',
    'protonamail.com': 'protonmail.com',
    'protonmial.com': 'protonmail.com',
}


def check_mx(domain):
    """Check if domain has MX records using dig or nslookup."""
    try:
        # Try dig first
        result = subprocess.run(
            ['dig', '+short', 'MX', domain],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            if lines and lines[0]:
                return True, lines
        # Fallback to nslookup
        result = subprocess.run(
            ['nslookup', '-type=MX', domain],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and 'mail exchanger' in result.stdout.lower():
            return True, result.stdout
        # Fallback to socket
        try:
            mx = socket.getaddrinfo(domain, None)
            return True, str(mx)
        except:
            return False, None
    except Exception:
        return False, None


def check_smtp(email, timeout=10):
    """Basic SMTP handshake check (port 25)."""
    try:
        domain = email.split('@')[1]
        mx_ok, mx_records = check_mx(domain)
        if not mx_ok:
            return False, 'No MX records'
        # Try to connect to first MX on port 25
        if mx_records and isinstance(mx_records, list):
            for line in mx_records:
                parts = line.strip().split()
                if len(parts) >= 2:
                    host = parts[-1].rstrip('.')
                    try:
                        sock = socket.create_connection((host, 25), timeout=timeout)
                        sock.close()
                        return True, 'SMTP port 25 reachable'
                    except:
                        continue
        return False, 'SMTP connection failed'
    except Exception as e:
        return False, str(e)


def classify_email(email):
    """Classify email type: personal, generic, recruitment, disposable."""
    local, domain = email.split('@')
    local_lower = local.lower()
    domain_lower = domain.lower()

    if domain_lower in DISPOSABLE_DOMAINS:
        return 'disposable'
    if local_lower in GENERIC_ALIASES:
        return 'generic'
    if local_lower in RECRUITMENT_ALIASES:
        return 'recruitment'
    if PERSONAL_EMAIL_RE.match(local_lower):
        return 'personal'
    return 'other'


def validate_email(email, check_smtp=False, check_catchall=False, timeout=10.0):
    """9-layer email verification."""
    result = {
        'is_valid': False,
        'reason': '',
        'verdict': 'unknown',
        'score': 0,
        'syntax_ok': False,
        'mx_ok': False,
        'disposable': False,
        'role_based': False,
        'free_provider': False,
        'catch_all': False,
        'smtp_ok': False,
        'typo_suggestion': None,
        'domain': '',
        'email_type': 'unknown',
    }

    # ── Layer 1: Syntax ────────────────────────────────────────────────
    if not email or '@' not in email:
        result['reason'] = 'Invalid syntax: no @ symbol'
        result['verdict'] = 'undeliverable'
        result['score'] = 0
        return result

    local, domain = email.split('@', 1)
    result['domain'] = domain.lower()

    if not EMAIL_RE.match(email):
        result['reason'] = 'Invalid email syntax'
        result['verdict'] = 'undeliverable'
        result['score'] = 0
        return result

    result['syntax_ok'] = True

    # ── Layer 2: Typo detection ────────────────────────────────────────
    domain_lower = domain.lower()
    if domain_lower in COMMON_TYPOS:
        corrected = COMMON_TYPOS[domain_lower]
        result['typo_suggestion'] = f'{local}@{corrected}'
        result['reason'] = f'Possible typo: {domain_lower} → {corrected}'
        result['verdict'] = 'undeliverable'
        result['score'] = 5
        return result

    # ── Layer 3: Disposable email check ────────────────────────────────
    if domain_lower in DISPOSABLE_DOMAINS:
        result['disposable'] = True
        result['reason'] = 'Disposable email domain'
        result['verdict'] = 'undeliverable'
        result['score'] = 0
        result['email_type'] = 'disposable'
        return result

    # ── Layer 4: Role-based / generic alias ────────────────────────────
    local_lower = local.lower()
    if local_lower in GENERIC_ALIASES:
        result['role_based'] = True
        result['reason'] = f'Generic/role-based alias ({local_lower})'
        result['verdict'] = 'risky'
        result['score'] = 30
        result['email_type'] = 'generic'
        # Still check MX — if MX exists, it's a valid generic
        mx_ok, _ = check_mx(domain)
        result['mx_ok'] = mx_ok
        if mx_ok:
            result['score'] = 40
            result['is_valid'] = True
        return result

    if local_lower in RECRUITMENT_ALIASES:
        result['role_based'] = True
        result['reason'] = f'Recruitment alias ({local_lower})'
        result['verdict'] = 'risky'
        result['score'] = 35
        result['email_type'] = 'recruitment'
        mx_ok, _ = check_mx(domain)
        result['mx_ok'] = mx_ok
        if mx_ok:
            result['score'] = 45
            result['is_valid'] = True
        return result

    # ── Layer 5: Free provider check ───────────────────────────────────
    if domain_lower in FREE_PROVIDERS:
        result['free_provider'] = True

    # ── Layer 6: MX record check ───────────────────────────────────────
    mx_ok, mx_records = check_mx(domain)
    result['mx_ok'] = mx_ok

    if not mx_ok:
        result['reason'] = f'No MX records found for {domain}'
        result['verdict'] = 'undeliverable'
        result['score'] = 10
        result['email_type'] = classify_email(email)
        return result

    # ── Layer 7: SMTP handshake (optional) ────────────────────────────
    if check_smtp:
        smtp_ok, smtp_reason = check_smtp(email, timeout)
        result['smtp_ok'] = smtp_ok
        if not smtp_ok:
            result['reason'] = f'SMTP check failed: {smtp_reason}'
            result['verdict'] = 'risky'
            result['score'] = 50
            result['email_type'] = classify_email(email)
            return result

    # ── Layer 8: Email classification ──────────────────────────────────
    result['email_type'] = classify_email(email)

    # ── Layer 9: Score calculation ─────────────────────────────────────
    score = 50  # Base score for valid syntax + MX

    if result['email_type'] == 'personal':
        score += 30  # Personal emails are high quality
    elif result['email_type'] == 'recruitment':
        score += 20  # Recruitment aliases are medium quality
    elif result['email_type'] == 'generic':
        score += 10  # Generic aliases are lower quality
    else:
        score += 15

    if not result['free_provider']:
        score += 10  # Company domain is better than free provider
    else:
        score -= 10  # Free provider penalty

    if result['smtp_ok']:
        score += 15  # SMTP verified

    score = max(0, min(100, score))
    result['score'] = score

    # ── Final verdict ──────────────────────────────────────────────────
    if score >= 70:
        result['verdict'] = 'safe'
        result['is_valid'] = True
        result['reason'] = f'Verified: {result["email_type"]} email at {domain} (score: {score})'
    elif score >= 40:
        result['verdict'] = 'risky'
        result['is_valid'] = True
        result['reason'] = f'Risky but acceptable: {result["email_type"]} email (score: {score})'
    elif score >= 20:
        result['verdict'] = 'risky'
        result['is_valid'] = False
        result['reason'] = f'Low confidence: {result["email_type"]} email (score: {score})'
    else:
        result['verdict'] = 'undeliverable'
        result['is_valid'] = False
        result['reason'] = f'Not verified (score: {score})'

    return result


class MailguardHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/validate':
            self.send_error(404, 'Not Found')
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, 'Invalid JSON')
            return

        email = data.get('email', '').strip()
        check_smtp = data.get('check_smtp', False)
        check_catchall = data.get('check_catchall', False)
        timeout = data.get('timeout', 10.0)

        if not email:
            self.send_error(400, 'Missing email parameter')
            return

        result = validate_email(email, check_smtp, check_catchall, timeout)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode('utf-8'))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'service': 'mailguard'}).encode('utf-8'))
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'service': 'MAILGUARD Email Verification API',
                'version': '1.0.0',
                'endpoints': {'POST /validate': 'Validate an email address'},
                'port': PORT,
            }).encode('utf-8'))

    def log_message(self, format, *args):
        # Log to stderr for PM2
        import sys
        sys.stderr.write(f"[MAILGUARD] {args[0]}\n")


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), MailguardHandler)
    print(f"[MAILGUARD] Server starting on http://127.0.0.1:{PORT}")
    print(f"[MAILGUARD] Endpoints: POST /validate, GET /health")
    server.serve_forever()
