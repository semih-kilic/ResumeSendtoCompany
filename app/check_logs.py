import json, sys

logs = json.load(sys.stdin)
print(f"Total logs: {len(logs)}")
for l in logs[:10]:
    print(f"  {l.get('host', 'N/A')} - {l.get('status', 'N/A')} - {l.get('impersonate', 'N/A')} - {l.get('url', 'N/A')[:80]}")
