import urllib.request, json, sys

results = []
errors = []

def test(name, url, expect_keys=None):
    try:
        r = urllib.request.urlopen(url, timeout=10)
        data = json.loads(r.read())
        status = '✅'
        detail = f'HTTP {r.status}'
        if expect_keys:
            if isinstance(data, dict):
                missing = [k for k in expect_keys if k not in data]
                if missing:
                    status = '⚠️'
                    detail += f' missing: {missing}'
            elif isinstance(data, list):
                detail += f' [{len(data)} items]'
        results.append(f'  {status} {name:40s} {detail}')
    except urllib.error.HTTPError as e:
        results.append(f'  ❌ {name:40s} HTTP {e.code}')
        errors.append(name)
    except Exception as e:
        results.append(f'  ❌ {name:40s} {str(e)[:60]}')
        errors.append(name)

# === CORE API ===
print("=" * 60)
print("  COMPREHENSIVE SYSTEM AUDIT")
print("=" * 60)

print("\n📡 CORE API")
test('Health Check', 'http://localhost:3002/api/health', ['ok', 'pid'])
test('Stats', 'http://localhost:3002/api/stats', ['totalCompanies', 'emailsSent'])
test('Scan Status', 'http://localhost:3002/api/scan/status', ['status'])

# === TEMPLATES ===
print("\n📝 TEMPLATES")
test('Job Outreach Template', 'http://localhost:3002/api/template', ['content'])
test('SaaS Pitch Template', 'http://localhost:3002/api/template/saas', ['content'])

# === CAMPAIGN ===
print("\n📧 CAMPAIGN & SENDING")
test('Campaign Status', 'http://localhost:3002/api/campaign/status', ['status'])
test('SaaS Status', 'http://localhost:3002/api/saas/status', ['status'])
test('Fit Stats', 'http://localhost:3002/api/fit/stats', ['evaluated'])

# === DATA ===
print("\n💾 DATA")
test('Emails List', 'http://localhost:3002/api/emails', ['records', 'total'])
test('Applications', 'http://localhost:3002/api/applications', ['records', 'total'])
test('Replies', 'http://localhost:3002/api/replies', ['replies'])
test('DLQ Items', 'http://localhost:3002/api/dlq/items', ['items', 'total'])
test('Analytics', 'http://localhost:3002/api/analytics', ['totals'])
test('Notifications', 'http://localhost:3002/api/notifications', ['notifications'])

# === SETTINGS ===
print("\n⚙️ SETTINGS")
test('Settings', 'http://localhost:3002/api/settings', ['smtp_pool'])

# === FRONTEND PAGES (HTML) ===
print("\n🖥️ FRONTEND PAGES")
for page in ['/', '/scan', '/leads', '/campaign', '/saas', '/replies', '/dlq', '/analytics', '/providers', '/settings', '/template']:
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{page}', timeout=5)
        data = r.read().decode()
        if '<!doctype html>' in data.lower() or '<html' in data.lower():
            size = len(data)
            results.append(f'  ✅ {page:40s} SPA loaded ({size:,} bytes)')
        else:
            results.append(f'  ❌ {page:40s} Not HTML')
            errors.append(page)
    except urllib.error.HTTPError as e:
        results.append(f'  ❌ {page:40s} HTTP {e.code}')
        errors.append(page)
    except Exception as e:
        results.append(f'  ❌ {page:40s} {str(e)[:50]}')
        errors.append(page)

# === EXTERNAL SERVICES ===
print("\n🔌 EXTERNAL SERVICES")
test('Mailguard', 'http://localhost:8001/', None)
test('limit-break Health', 'http://localhost:8080/health', ['total'])

# Print results
for r in results:
    print(r)

print("\n" + "=" * 60)
if errors:
    print(f"  ❌ {len(errors)} ERRORS: {', '.join(errors)}")
else:
    print("  ✅ ALL SYSTEMS OPERATIONAL")
print("=" * 60)
