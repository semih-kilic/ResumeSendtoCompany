# 🔧 Resilience & Failover System Guide (OMEGA V5)

## Overview

The application has been enhanced with a comprehensive **resilience framework** to ensure it NEVER stops due to API failures, quota exhaustion, or service degradation.

### 🔥 OMEGA V5 System Upgrades
- **Zero-HTML Codebase:** Hardcoded HTML emails are extracted into `templates/` folder for clean separation of logic and presentation.
- **Node.js Immortality:** `uncaughtException` and `unhandledRejection` guards prevent unexpected zombie processes.
- **Smart Proxy Cooldowns:** Reduced proxy lockout from 24h to 5m, preventing permanent system stalling.
- **RFC822 IMAP Parser:** AI reads pure text without HTML tags for 100% accurate sentiment analysis.
- **DB Write Consistency:** Enforced `PRAGMA busy_timeout = 5000` to handle intense parallel Scraper + Frontend loads.

**Key Principles:**
- ✅ **Always Keep Running**: Circuit breakers, dead letter queues, and graceful degradation
- ✅ **Intelligent Failover**: Automatic provider switching (Gemini → OpenAI, Resend → SMTP)
- ✅ **Smart Retry Logic**: Exponential backoff with jitter for transient errors
- ✅ **Quota Management**: Detect and mark providers as unavailable instead of crashing
- ✅ **Dead Letter Queue**: Capture failed items for later retry

---

## 🎯 Components

### 1. CircuitBreaker (resilience-manager.js)

**Purpose:** Prevent cascading failures by tracking consecutive errors

```javascript
// States:
// CLOSED    - Service is healthy, requests go through
// OPEN      - Service is failing, requests are rejected
// HALF_OPEN - Testing if service recovered
```

**Behavior:**
- Opens after N consecutive failures
- Automatically transitions to HALF_OPEN after timeout
- Recovers if requests succeed during HALF_OPEN state

**Example:** AI Advisor uses CircuitBreaker to isolate Gemini/OpenAI failures

---

### 2. RetryManager (resilience-manager.js)

**Purpose:** Intelligently retry transient failures

**Features:**
- Exponential backoff: `delay = initialDelay * multiplier^attempt`
- Jitter: Prevents thundering herd problem
- Non-retryable errors: 400, 401, 403, 404 (fail fast)
- Retryable errors: 429, 500, 503, 504 (retry with backoff)

**Example:**
```javascript
await retryManager.executeWithRetry(
  () => callApi(),
  'Calling external API'
);
// Automatic retry up to maxRetries times with exponential backoff
```

---

### 3. DeadLetterQueue (resilience-manager.js)

**Purpose:** Capture failed items for later retry

**Database Table:**
```sql
dead_letter_queue (
  id, item_type, item_id, payload, error_message,
  retry_count, max_retries, created_at, status
)
```

**Item Flow:**
1. Item fails → Added to DLQ
2. Next processing round → DLQ items are retried
3. Success → Marked as `completed`
4. Max retries exceeded → Marked as `failed`

**Example (Email):**
```javascript
if (allSmtpAccountsFailed) {
  dlq.addItem('email', email, { email, company }, error, maxRetries=10);
  // Email will be retried in the next round
}
```

---

### 4. HealthMonitor (resilience-manager.js)

**Purpose:** Track service health and provide status visibility

**Usage:**
```javascript
healthMonitor.registerHealthCheck('gemini-api', async () => {
  const test = await callGemini();
  if (!test) throw new Error('Gemini unavailable');
});

healthMonitor.startMonitoring(); // Runs every 30 seconds
const status = healthMonitor.getStatus(); // Get current status
```

---

### 5. ProviderRegistry (resilience-manager.js)

**Purpose:** Manage multiple providers and automatic fallback

**Example:**
```javascript
registry.register('ai-generation', 'gemini', {
  canUse: () => !quotaExhausted,
  execute: (prompt) => callGemini(prompt),
});
registry.register('ai-generation', 'openai', {
  canUse: () => !quotaExhausted,
  execute: (prompt) => callOpenAI(prompt),
});

// Automatically tries providers in order until one succeeds
const result = await registry.executeWithFallback('ai-generation', prompt);
```

---

## 📧 Email System (SendEngine) Resilience

### Multi-Provider Strategy

**Provider Order:**
1. **Resend** (if configured and healthy)
2. **SMTP Pool** (round-robin across multiple SMTP accounts)
3. **Dead Letter Queue** (if all providers fail)

### SMTP Pool Failover

```javascript
// config.toml example
[[smtp_pool]]
host = "smtp1.example.com"
username = "account1@example.com"
password = "${SMTP_PASS_1}"

[[smtp_pool]]
host = "smtp2.example.com"
username = "account2@example.com"
password = "${SMTP_PASS_2}"

[[smtp_pool]]
host = "smtp3.example.com"
username = "account3@example.com"
password = "${SMTP_PASS_3}"
```

### DLQ Retry Loop

**Automatic Process:**
- Every round, after processing main queue
- Retries up to 20 items from DLQ
- Tries Resend first, then SMTP
- If still fails, marks for next round retry

**Status:**
```javascript
const stats = dlq.getStats();
// Output:
// {
//   pending: 5,
//   completed: 120,
//   failed: 3
// }
```

---

## 🤖 AI System (AIAdvisor) Resilience

### Quota Detection

**Monitored Error Codes:**
- `429` - Rate Limited
- `402` - Payment Required (billing issue)
- `401/403` - Auth Failure

### Behavior

1. **First Error:** Log and try next provider
2. **Quota Error:** Mark provider as unavailable for 1 hour (or 24 hours for billing)
3. **Circuit Breaker Open:** Provider is skipped entirely
4. **All Providers Down:** Gracefully return `null` instead of crashing

### Example

```javascript
// Gemini fails with 429 (quota)
// System marks Gemini unavailable for 1 hour
// NextRequest uses OpenAI instead
// If OpenAI also fails → Returns null (no personalization, but email still sends)
```

---

## 🔍 Web Scraping (Scraper) Resilience

### Current Behavior

**Provider Hierarchy:**
1. Direct website scraping (free, high confidence)
2. ZENROWS proxy (paid, fallback)
3. STEALTH direct fetch (free, last resort)

**Note:** Already has good fallback structure but could benefit from:
- Circuit breaker for ZENROWS (currently doesn't handle 402 gracefully)
- DLQ for failed scrapers (to retry in next round)

---

## 📊 Monitoring & Logging

### Log Patterns

**Circuit Breaker:**
```
[CIRCUIT-BREAKER] gemini-ai OPEN after 5 failures
[CIRCUIT-BREAKER] gemini-ai entering HALF_OPEN state
[CIRCUIT-BREAKER] gemini-ai RECOVERED
```

**Retry Manager:**
```
[RETRY] Gemini intro generation failed. Retrying in 2500ms... (attempt 1/2)
```

**Dead Letter Queue:**
```
[DLQ] Added email:user@example.com to dead letter queue
[DLQ] Retrying user@example.com (retry count: 3/10)
[DLQ] ✅ Successfully resent to user@example.com via Resend
[DLQ] Stats: {"pending": 5, "completed": 120, "failed": 3}
```

**Health Monitor:**
```
[HEALTH] Checking services...
[HEALTH] gemini-api: HEALTHY
[HEALTH] openai-api: UNHEALTHY (Quota exceeded)
[HEALTH] resend-email: HEALTHY
```

---

## 🚀 Deployment

### 1. Install Resilience Module

Already included in `backend/resilience-manager.js`

### 2. Configure in server.js

```javascript
import { AIAdvisor } from './ai-advisor.js';
import { SendEngine } from './send-engine.js';
import { HealthMonitor } from './resilience-manager.js';

const healthMonitor = new HealthMonitor({ checkIntervalSecs: 30 });
const aiAdvisor = new AIAdvisor(config);
const sendEngine = new SendEngine(db, config, aiAdvisor);

// Register health checks
healthMonitor.registerHealthCheck('gemini-api', async () => {
  // Test Gemini API
});
healthMonitor.startMonitoring();
```

### 3. Database Migration

The DLQ table is created automatically on first use:
```javascript
new DeadLetterQueue(db); // Creates table if needed
```

### 4. Testing

Run smoke tests:
```powershell
cd backend
node smoke-test.js
```

Expected output when API is down:
```
[AI-ADVISOR] Gemini failed: 429 Too Many Requests
[AI-ADVISOR] Prompting OpenAI (Gemini failed)...
[AI-ADVISOR] All AI providers unavailable. Using generic intro.
✅ [SENT via SMTP] Email sent without personalization
```

---

## 🔄 Recovery Scenarios

### Scenario 1: Gemini API Quota Exhausted

| Time | Action | Result |
|------|--------|--------|
| 11:00 | Gemini quota error (429) | Marked unavailable for 1 hour |
| 11:05 | Next email needs personalization | Uses OpenAI instead |
| 12:00 | Quota hour expires | Tries Gemini again, succeeds |

### Scenario 2: All SMTP Accounts Hit Reputation Limits

| Time | Action | Result |
|------|--------|--------|
| 11:00 | SMTP #1 rejected (spam) | Rotate to SMTP #2 |
| 11:05 | SMTP #2 rejected (spam) | Rotate to SMTP #3 |
| 11:10 | SMTP #3 rejected (spam) | All exhausted → DLQ 20 emails |
| 11:15 | Continue processing | Processes remaining emails normally |
| 11:30 | New round starts | Retries 20 DLQ emails with fresh attempt |

### Scenario 3: Transient Network Error

| Time | Action | Result |
|------|--------|--------|
| 11:00 | SMTP timeout | Retry Manager kicks in |
| 11:05 | Retry attempt 1 | Still failing |
| 11:10 | Retry attempt 2 | Success! Continue processing |

---

## 🔧 Configuration Tips

### Tune Retry Behavior

```javascript
// In resilience-manager.js
const retryManager = new RetryManager({
  maxRetries: 3,           // More aggressive retry
  initialDelayMs: 1000,    // Start with 1 second
  maxDelayMs: 60000,       // Cap at 1 minute
  backoffMultiplier: 2,    // Double delay each time
});
```

### Tune Circuit Breaker

```javascript
const breaker = new CircuitBreaker('my-service', {
  failureThreshold: 3,     // Open after 3 failures
  successThreshold: 2,     // Close after 2 successes
  timeoutSecs: 300,        // Try again after 5 minutes
});
```

### Tune DLQ Retry Count

```javascript
dlq.addItem(type, id, payload, error, 
  maxRetries = 10  // Retry up to 10 times
);
```

---

## 📌 Summary

The application now has **production-grade resilience** with:

✅ **Auto-recovery** from transient failures  
✅ **Smart failover** between multiple providers  
✅ **Queue-based** retry for failed items  
✅ **Health monitoring** for visibility  
✅ **Graceful degradation** instead of crashes  

**Result:** System NEVER stops due to quota/billing issues. It adapts and recovers automatically.
