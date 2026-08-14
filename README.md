# Autonomous Outreach System

**A self-hosted engine for automated, AI-personalized outreach at scale.**

Discover contacts → verify emails → write a personalized message with AI → send through a rotating provider pool → track replies. One framework, run it in whichever mode fits what you're doing:

- 🧑‍💼 **Job Search Mode** — discover companies, score your fit against each job/company profile, and send a personalized application with your resume attached.
- 📈 **B2B Sales Mode** — discover leads from business directories, verify and score them, run a multi-step cold-email + follow-up sequence, and surface hot replies.

Both modes share the same discovery, verification, AI-personalization, sending, and reply-tracking pipeline — you're just pointing it at a different `config.toml` and template set.

[![CI](https://github.com/semih-kilic/Autonomous-Outreach-System/actions/workflows/ci.yml/badge.svg)](https://github.com/semih-kilic/Autonomous-Outreach-System/actions/workflows/ci.yml)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org)
[![MIT License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/semih-kilic/Autonomous-Outreach-System)](https://github.com/semih-kilic/Autonomous-Outreach-System/stargazers)

---

## Why this exists

Cold outreach tools (Instantly, Smartlead, lemlist, and similar) are subscription SaaS products with your data on someone else's servers, and they usually don't let you touch the pipeline. This is the opposite: it's yours, it runs on your own infrastructure, and every stage — discovery, verification, personalization, sending, follow-up — is a file you can read and change.

It started as a personal tool to automate my own job search. The underlying pipeline (find a target → verify a contact → personalize a message → send → track the reply) turned out to be identical whether the "target" is a hiring company or a sales lead, so it's now a general framework with two first-class configurations.

## How it works

```
┌────────────────────────────┐   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│  Discovery   │──▶│ Verification │──▶│ AI Personal- │──▶│   Sending    │──▶│ Reply Track- │
│              │   │              │   │  ization     │   │              │   │  ing         │
│ Directory /  │   │ Domain Trust │   │ Gemini /     │   │ SMTP pool /  │   │ IMAP inbox   │
│ dork scraping│   │ → MX → API   │   │ OpenAI       │   │ Resend       │   │ monitoring   │
└────────────────────────────┘   └────────────────────┘   └────────────────────┘   └────────────────────┘   └────────────────────┘
```

- **Backend:** Node.js (Express)
- **Frontend:** React + Vite dashboard for monitoring campaigns
- **Database:** SQLite, zero external dependencies to get running
- **Process management:** PM2 with auto-restart, memory limits, and crash recovery baked in
- **AI:** Google Gemini and OpenAI, swappable per step

## Quickstart (developers, self-hosted)

```bash
git clone https://github.com/semih-kilic/Autonomous-Outreach-System.git
cd Autonomous-Outreach-System
npm install
cp .env.example .env
cp config.toml.example config.toml
# edit .env and config.toml with your own API keys / SMTP credentials
npm run dev
```

Dashboard: `http://localhost:3002`

Pick your mode by editing `config.toml`:

| | Job Search Mode | B2B Sales Mode |
|---|---|---|
| Enable | `job_fit_enabled = true`, set `resume_path` | `saas_from_name`, `saas_from_email` |
| Template | `templates/outreach.html` | `templates/saas-pitch.html` + `templates/saas-followup.html` |
| Scoring | `job_fit_min_score` | `hot_lead_threshold` |
| Discovery source | job boards / company directories | `bbb-importer.js`, `chamber-importer.js`, Google dorking |

Full config reference: `config.toml.example`.

## Responsible use

This tool can send email at scale to contacts it has never interacted with. That makes it powerful and also easy to misuse. Before running a campaign:

- **Know your jurisdiction's rules.** Canada's CASL, the US CAN-SPAM Act, and the EU's GDPR/ePrivacy rules all impose real requirements (consent, sender identification, working unsubscribe) on unsolicited commercial email. Job applications to a named hiring contact are generally treated differently from bulk sales prospecting — don't assume the same rules apply to both modes.
- **Always include a working unsubscribe / opt-out path** and honor it immediately.
- **Respect target sites' terms of service** when scraping — the discovery layer includes anti-detection and proxy rotation utilities that exist for resilience against rate-limiting, not to justify bypassing a site's explicit access rules.
- This project ships as-is, MIT-licensed; you are responsible for how you configure and run it.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: additional lead-discovery sources, additional email providers, test coverage for `send-engine.js` and `verifier.js`.

## License

MIT — see [LICENSE](LICENSE).
