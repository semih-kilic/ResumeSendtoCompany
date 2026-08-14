import urllib.request, json

for path, name in [('/api/template', 'Job Outreach'), ('/api/template/saas', 'CyberSec Pro SaaS')]:
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{path}')
        d = json.loads(r.read())
        content = d.get('content', '')
        if 'SaaS Template Not Found' in content:
            print(f'[{name}] ❌ NOT FOUND (fallback)')
        else:
            print(f'[{name}] ✅ {len(content)} chars — starts with: {content[:100]}')
    except Exception as e:
        print(f'[{name}] ❌ ERROR: {e}')
