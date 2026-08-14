import urllib.request, json

pages = [
    ('/', 'Frontend Root'),
    ('/api/health', 'Health Check'),
    ('/api/stats', 'Stats'),
    ('/api/scan/status', 'Scan Status'),
    ('/api/template', 'Job Outreach Template'),
    ('/api/template/saas', 'SaaS Template'),
    ('/api/settings', 'Settings'),
    ('/api/leads', 'Leads'),
    ('/api/replies', 'Replies'),
    ('/api/dlq', 'Dead Letter Queue'),
    ('/api/analytics', 'Analytics'),
]

print("=" * 55)
print("         FRONTEND & API PAGE TEST")
print("=" * 55)

for path, name in pages:
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{path}', timeout=5)
        status = r.status
        data = r.read().decode()
        size = len(data)
        if size > 500:
            print(f"  ✅ {name:25s} — HTTP {status} ({size:,} bytes)")
        else:
            print(f"  ✅ {name:25s} — HTTP {status}")
    except urllib.error.HTTPError as e:
        print(f"  ❌ {name:25s} — HTTP {e.code}")
    except Exception as e:
        print(f"  ❌ {name:25s} — {e}")

print("=" * 55)
