import urllib.request
import json

url = "http://localhost:8080/v1/fetch"
data = json.dumps({
    "url": "https://www.google.com/maps/search/restaurant+group+in+Toronto",
    "use_proxy": True,
    "timeout": 20
}).encode()
req = urllib.request.Request(url, data=data, headers={
    "Content-Type": "application/json",
    "X-API-Key": "canada-scrape-key"
})
resp = urllib.request.urlopen(req, timeout=30)
result = json.loads(resp.read())
print(f"Status: {result.get('status')}")
print(f"Body length: {len(result.get('body', ''))}")
print(f"Impersonate: {result.get('impersonate')}")
print(f"Proxy: {result.get('proxy')}")
# Print first 500 chars of body
body = result.get('body', '')
print(f"\n--- Body Preview ---")
print(body[:1000])
