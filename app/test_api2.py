import urllib.request, json

endpoints = [
    '/api/emails',
    '/api/applications',
    '/api/replies',
    '/api/dlq/items',
    '/api/fit/stats',
    '/api/analytics',
    '/api/saas/status',
    '/api/campaign/status',
    '/api/notifications/unread-count',
]

for ep in endpoints:
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{ep}', timeout=5)
        d = json.loads(r.read())
        if isinstance(d, list):
            print(f"  ✅ {ep:35s} — {len(d)} records")
        elif isinstance(d, dict):
            keys = list(d.keys())[:3]
            print(f"  ✅ {ep:35s} — keys: {keys}")
        else:
            print(f"  ✅ {ep:35s} — {type(d).__name__}")
    except urllib.error.HTTPError as e:
        print(f"  ❌ {ep:35s} — HTTP {e.code}")
    except Exception as e:
        print(f"  ❌ {ep:35s} — {e}")
