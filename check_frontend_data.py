import urllib.request, json

# Test all data endpoints that frontend charts need
print("=== FRONTEND DATA ENDPOINTS ===")

endpoints = {
    '/api/stats': 'Dashboard stats card',
    '/api/analytics': 'Analytics page charts',
    '/api/fit/stats': 'Fit evaluation chart',
    '/api/emails?page=1&limit=5': 'Emails table',
    '/api/applications?page=1&limit=5': 'Applications table',
    '/api/dlq/items?page=1&limit=5': 'DLQ table',
    '/api/saas/status': 'SaaS status',
    '/api/campaign/status': 'Campaign status',
    '/api/scan/status': 'Scan status',
    '/api/notifications/unread-count': 'Notification badge',
    '/api/settings': 'Settings form',
}

all_ok = True
for ep, desc in endpoints.items():
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{ep}', timeout=5)
        d = json.loads(r.read())
        # Check data quality
        if isinstance(d, dict):
            keys = len(d.keys())
            print(f"  ✅ {ep:40s} → {keys} keys ({desc})")
        elif isinstance(d, list):
            print(f"  ✅ {ep:40s} → {len(d)} items ({desc})")
        else:
            print(f"  ✅ {ep:40s} → {type(d).__name__} ({desc})")
    except urllib.error.HTTPError as e:
        print(f"  ❌ {ep:40s} → HTTP {e.code} ({desc})")
        all_ok = False
    except Exception as e:
        print(f"  ❌ {ep:40s} → {str(e)[:50]} ({desc})")
        all_ok = False

# Check CORS headers
print("\n=== CORS CHECK ===")
try:
    req = urllib.request.Request('http://localhost:3002/api/health')
    r = urllib.request.urlopen(req, timeout=5)
    headers = dict(r.headers)
    cors = headers.get('Access-Control-Allow-Origin', 'NOT SET')
    print(f"  Access-Control-Allow-Origin: {cors}")
except Exception as e:
    print(f"  ❌ {e}")

# Check static file serving
print("\n=== STATIC FILES ===")
for path, name in [('/favicon.svg', 'Favicon'), ('/assets/index-sgqAs7NV.js', 'Main JS'), ('/assets/index-CSdTJ7ew.css', 'Main CSS')]:
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{path}', timeout=5)
        size = len(r.read())
        print(f"  ✅ {name:20s} → {size:,} bytes")
    except Exception as e:
        print(f"  ❌ {name:20s} → {e}")

print("\n" + "=" * 50)
print(f"  {'✅ ALL FRONTEND DATA OK' if all_ok else '❌ SOME ERRORS FOUND'}")
print("=" * 50)
