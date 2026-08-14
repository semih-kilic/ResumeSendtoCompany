import urllib.request, json

key = "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"
base = "https://integrate.api.nvidia.com/v1"

# Test available models
print("=== NVIDIA NIM MODELS ===")
try:
    req = urllib.request.Request(f'{base}/models', headers={'Authorization': f'Bearer {key}'})
    r = urllib.request.urlopen(req, timeout=10)
    d = json.loads(r.read())
    models = [m['id'] for m in d.get('data', [])]
    print(f"  Total models: {len(models)}")
    for m in sorted(models):
        print(f"    {m}")
except urllib.error.HTTPError as e:
    print(f"  ❌ HTTP {e.code}: {e.read().decode()[:200]}")
except Exception as e:
    print(f"  ❌ {e}")

# Test chat completion with a good model
print("\n=== CHAT TEST ===")
for model in ["meta/llama-3.1-8b-instruct", "meta/llama-3.1-70b-instruct", "mistralai/mistral-large-2-instruct"]:
    try:
        data = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": "Say hi in 3 words"}],
            "max_tokens": 20,
            "temperature": 0.1
        }).encode()
        req = urllib.request.Request(f'{base}/chat/completions', data=data, headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
        r = urllib.request.urlopen(req, timeout=30)
        d = json.loads(r.read())
        text = d['choices'][0]['message']['content'].strip()
        print(f"  ✅ {model}: {text}")
        break
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:150]
        print(f"  ❌ {model}: HTTP {e.code} — {err[:100]}")
    except Exception as e:
        print(f"  ❌ {model}: {e}")
