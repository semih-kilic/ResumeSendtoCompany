import urllib.request, json, socket, subprocess, sys

results = {}

# 1. Server Health
try:
    r = urllib.request.urlopen('http://localhost:3002/api/health', timeout=5)
    d = json.loads(r.read())
    results['server'] = f"✅ OK — uptime {d.get('uptime','?')}"
except Exception as e:
    results['server'] = f"❌ FAIL — {e}"

# 2. Stats
try:
    r = urllib.request.urlopen('http://localhost:3002/api/stats', timeout=5)
    d = json.loads(r.read())
    results['stats'] = f"✅ OK — {d.get('totalCompanies',0)} companies, {d.get('emailsVerified',0)} verified, {d.get('emailsSent',0)} sent"
except Exception as e:
    results['stats'] = f"❌ FAIL — {e}"

# 3. Scan Status
try:
    r = urllib.request.urlopen('http://localhost:3002/api/scan/status', timeout=5)
    d = json.loads(r.read())
    results['scan'] = f"✅ OK — status={d.get('status','?')}"
except Exception as e:
    results['scan'] = f"❌ FAIL — {e}"

# 4. Templates
for path, name in [('/api/template', 'outreach'), ('/api/template/saas', 'saas-pitch')]:
    try:
        r = urllib.request.urlopen(f'http://localhost:3002{path}', timeout=5)
        d = json.loads(r.read())
        c = d.get('content', '')
        if 'SaaS Template Not Found' in c:
            results[f'template_{name}'] = f"❌ FAIL — SaaS Template Not Found"
        else:
            results[f'template_{name}'] = f"✅ OK — {len(c)} chars"
    except Exception as e:
        results[f'template_{name}'] = f"❌ FAIL — {e}"

# 5. Settings / Config
try:
    r = urllib.request.urlopen('http://localhost:3002/api/settings', timeout=5)
    d = json.loads(r.read())
    smtp = d.get('smtp_pool', [])
    results['settings'] = f"✅ OK — {len(smtp)} SMTP accounts configured"
except Exception as e:
    results['settings'] = f"❌ FAIL — {e}"

# 6. Mailguard (port 8001)
try:
    r = urllib.request.urlopen('http://localhost:8001/', timeout=5)
    results['mailguard'] = f"✅ OK — HTTP {r.status}"
except Exception as e:
    results['mailguard'] = f"❌ FAIL — {e}"

# 7. Mailguard verification test
try:
    data = json.dumps({"email": "test@gmail.com"}).encode()
    req = urllib.request.Request('http://localhost:8001/validate', data=data, headers={'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=15)
    d = json.loads(r.read())
    results['mailguard_verify'] = f"✅ OK — verdict={d.get('verdict','?')} score={d.get('score','?')}"
except Exception as e:
    results['mailguard_verify'] = f"❌ FAIL — {e}"

# 8. limit-break (port 8080)
try:
    r = urllib.request.urlopen('http://localhost:8080/health', timeout=5)
    d = json.loads(r.read())
    proxies = d.get('proxyCount', d.get('proxies', '?'))
    results['limitbreak'] = f"✅ OK — {proxies} proxies"
except Exception as e:
    results['limitbreak'] = f"❌ FAIL — {e}"

# 9. Docker container
try:
    out = subprocess.check_output(['docker', 'ps', '--filter', 'name=limitbreak', '--format', '{{.Status}}'], timeout=5).decode().strip()
    results['docker'] = f"✅ OK — {out}" if out else "❌ FAIL — container not running"
except Exception as e:
    results['docker'] = f"❌ FAIL — {e}"

# 10. PM2 status
try:
    out = subprocess.check_output(['pm2', 'jlist'], timeout=5).decode()
    apps = json.loads(out)
    for app in apps:
        name = app.get('name', '?')
        status = app.get('pm2_env', {}).get('status', '?')
        restarts = app.get('pm2_env', {}).get('restart_time', 0)
        results[f'pm2_{name}'] = f"✅ OK — status={status}, restarts={restarts}"
except Exception as e:
    results['pm2'] = f"❌ FAIL — {e}"

# 11. Node.js process memory
try:
    out = subprocess.check_output(['pm2', 'jlist'], timeout=5).decode()
    apps = json.loads(out)
    for app in apps:
        mem = app.get('monit', {}).get('memory', 0)
        cpu = app.get('monit', {}).get('cpu', 0)
        results['pm2_mem'] = f"Memory: {mem//1024//1024}MB, CPU: {cpu}%"
except:
    pass

# 12. Disk space
try:
    out = subprocess.check_output(['df', '-h', '/home/ubuntu'], timeout=5).decode()
    lines = out.strip().split('\n')
    if len(lines) > 1:
        parts = lines[1].split()
        results['disk'] = f"✅ OK — {parts[2]} used / {parts[1]} total ({parts[4]} used)"
except Exception as e:
    results['disk'] = f"❌ FAIL — {e}"

# 13. SQLite DB integrity
try:
    out = subprocess.check_output(['sqlite3', '/home/ubuntu/app/data/canada.db', 'PRAGMA integrity_check;'], timeout=5).decode().strip()
    results['db_integrity'] = f"✅ OK — {out}" if out == 'ok' else f"❌ FAIL — {out}"
except Exception as e:
    results['db_integrity'] = f"❌ FAIL — {e}"

# 14. DB table counts
try:
    for table in ['companies', 'email_records', 'send_log', 'send_log_saas', 'dead_letter_queue']:
        out = subprocess.check_output(['sqlite3', '/home/ubuntu/app/data/canada.db', f'SELECT COUNT(*) FROM {table};'], timeout=5).decode().strip()
        results[f'db_{table}'] = f"  {table}: {out} rows"
except Exception as e:
    results['db_tables'] = f"❌ FAIL — {e}"

# 15. SMTP connectivity test (port 465)
for host, port, name in [('smtp.gmail.com', 465, 'gmail1'), ('smtp.gmail.com', 465, 'gmail2'), ('in-v3.mailjet.com', 465, 'mailjet'), ('smtp-relay.brevo.com', 587, 'brevo'), ('email-smtp.us-east-1.amazonaws.com', 465, 'ses')]:
    try:
        s = socket.create_connection((host, port), timeout=5)
        s.close()
        results[f'smtp_{name}'] = f"✅ OK — {host}:{port} reachable"
    except Exception as e:
        results[f'smtp_{name}'] = f"❌ FAIL — {host}:{port} — {e}"

# 16. Gemini API key test
try:
    r = urllib.request.urlopen('https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyDfHKz2gMmRMjRbU4q6z3MnKjPz-abc123', timeout=5)
    results['gemini'] = f"✅ OK"
except urllib.error.HTTPError as e:
    if e.code == 400:
        results['gemini'] = "❌ FAIL — API key invalid (400)"
    else:
        results['gemini'] = f"⚠️ HTTP {e.code}"
except Exception as e:
    results['gemini'] = f"❌ FAIL — {e}"

# Print results
print("=" * 60)
print("       FULL SYSTEM HEALTH CHECK")
print("=" * 60)
for k, v in sorted(results.items()):
    print(f"  {v}")
print("=" * 60)
