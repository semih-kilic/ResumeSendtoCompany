# 🇨🇦 Canada Omega - Autonomous Outreach Engine

Canada Omega is a production-grade, 24/7 autonomous outreach system designed for lead discovery, LinkedIn enrichment, and personalized AI-driven campaign delivery.

## 🚀 Core Features

- **Autonomous Discovery:** Continuous scanning of Canadian business directories (YellowPages, BBB, Chamber of Commerce) and Google Dorks.
- **Hybrid Enrichment:** Extracts LinkedIn profiles directly from company websites (On-site Scraping) with fallback to proxy-based search engine enrichment.
- **Intelligent Verification:** Multi-layer email verification (Domain Trust -> MX Check -> Provider APIs) with a "Shield Mode" for sender reputation protection.
- **SaaS Sales Engine:** Specialized campaign loop for B2B SaaS outreach with automated multi-step follow-ups.
- **AI Personalization:** Real-time generation of personalized email intros using Gemini 1.5 Flash.
- **SMTP Relay Pool:** Intelligent rotation between Gmail, Resend, Yandex, and Brevo to bypass rate limits.

## 🛠 Technical Architecture

- **Backend:** Node.js (Express)
- **Database:** SQLite (`data/canada.db`)
- **Orchestration:** PM2 with autonomous watchdog logic.
- **AI Integration:** Google Gemini & OpenAI.
- **Scraping Fallbacks:** ScraperAPI, ScrapingBee, ZenRows.

## 📁 Key Directories

- `/backend`: Core logic, engines, and database handlers.
- `/backend/data`: Persistent storage (Database, CVs, Logs).
- `/backend/data/logs`: Operational logs for debugging.

## ⚙️ Configuration

Settings are managed via `backend/config.toml`. Key parameters include:
- `smtp_pool`: Rotation of sender accounts.
- `verification`: API keys and strictness levels.
- `scraping`: Proxy providers and concurrency limits.

## 🚦 Operational Commands

```bash
# Start the system
pm2 start ecosystem.config.cjs

# Monitor logs
pm2 logs canada-omega

# Check process status
pm2 status
```

---
*Maintained by Antigravity AI Coding Assistant.*


## Security / Secrets

Real credentials live in `config.toml`, which is intentionally ignored by git. Use `config.toml.example` as the template and fill secrets only on the server or in your deployment secret store.

Before publishing, run a secret scan and confirm no real API keys, SMTP passwords, databases, uploads, or generated documents are staged.
