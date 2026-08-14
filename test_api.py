import urllib.request
import json

url = "http://localhost:8001/validate"
data = json.dumps({"email": "test@gmail.com"}).encode()
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req, timeout=15)
print(json.dumps(json.loads(resp.read()), indent=2))
