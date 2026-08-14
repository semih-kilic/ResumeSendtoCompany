import urllib.request, json

# Mailguard validate test
print("=== MAILGUARD /validate ===")
try:
    data = json.dumps({"email": "test@gmail.com"}).encode()
    req = urllib.request.Request('http://localhost:8001/validate', data=data, headers={'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=15)
    d = json.loads(r.read())
    print(f"  verdict={d.get('verdict')} score={d.get('score')} definitive={d.get('_definitive')}")
except Exception as e:
    print(f"  ❌ {e}")

# Notifications endpoint
print("\n=== NOTIFICATIONS ===")
try:
    r = urllib.request.urlopen('http://localhost:3002/api/notifications', timeout=5)
    d = json.loads(r.read())
    print(f"  Keys: {list(d.keys())}")
    print(f"  Data: {json.dumps(d, indent=2)[:300]}")
except Exception as e:
    print(f"  ❌ {e}")

# Notifications unread count
print("\n=== NOTIFICATIONS UNREAD ===")
try:
    r = urllib.request.urlopen('http://localhost:3002/api/notifications/unread-count', timeout=5)
    d = json.loads(r.read())
    print(f"  {d}")
except Exception as e:
    print(f"  ❌ {e}")

# Reoon provider health
print("\n=== PROVIDER HEALTH ===")
try:
    r = urllib.request.urlopen('http://localhost:3002/api/settings', timeout=5)
    d = json.loads(r.read())
    print(f"  verification.provider: {d.get('verification', {}).get('provider', '?')}")
    print(f"  verification.enabled: {d.get('verification', {}).get('enabled', '?')}")
except Exception as e:
    print(f"  ❌ {e}")

# Check analytics data for charts
print("\n=== ANALYTICS DATA ===")
try:
    r = urllib.request.urlopen('http://localhost:3002/api/analytics', timeout=5)
    d = json.loads(r.read())
    print(f"  totals: {d.get('totals', {})}")
    print(f"  byProvider: {d.get('byProvider', {})}")
    print(f"  byAction: {d.get('byAction', {})}")
except Exception as e:
    print(f"  ❌ {e}")
