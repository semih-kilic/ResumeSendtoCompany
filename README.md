# 🚀 ResumeSendtoCompany - Autonomous Outreach System

<div align="center">
  <img src="assets/logo.svg" alt="ResumeSendtoCompany Logo" width="120">
  <br>
  <img src="https://img.shields.io/badge/Status-Production%20Ready-brightgreen" alt="Production Ready">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/AI-Gemini%201.5%20Flash-orange" alt="Gemini 1.5 Flash">
  <img src="https://img.shields.io/github/stars/semih-kilic/ResumeSendtoCompany" alt="GitHub Stars">
  <img src="https://img.shields.io/github/forks/semih-kilic/ResumeSendtoCompany" alt="GitHub Forks">
</div>

## 🖼️ Preview

<img src="assets/demo-preview.svg" alt="ResumeSendtoCompany Dashboard Preview">

## 📋 Overview

ResumeSendtoCompany is a production-grade, 24/7 autonomous outreach system designed for lead discovery, LinkedIn enrichment, and personalized AI-driven campaign delivery. It automates the entire process from finding leads to sending personalized emails with AI-generated content.

## ✨ Key Features

### 🔍 Autonomous Discovery
- **Multi-Source Scraping:** Continuous scanning of Canadian business directories (YellowPages, BBB, Chamber of Commerce)
- **Google Dorks Integration:** Advanced search patterns for targeted lead discovery
- **Smart Filtering:** AI-powered lead qualification and enrichment

### 🤖 AI-Powered Personalization
- **Real-time Content Generation:** Uses Gemini 1.5 Flash for personalized email intros
- **Dynamic Templates:** Context-aware email content based on company analysis
- **Multi-language Support:** Capable of generating content in multiple languages

### 📧 Intelligent Email System
- **SMTP Relay Pool:** Intelligent rotation between Gmail, Resend, Yandex, and Brevo
- **Multi-layer Verification:** Domain Trust → MX Check → Provider APIs
- **Shield Mode:** Sender reputation protection with advanced rate limiting
- **Deliverability Optimization:** SPF, DKIM, and DMARC compliance checking

### 🎯 SaaS Sales Engine
- **Specialized Campaigns:** B2B SaaS outreach with automated multi-step follow-ups
- **Lead Scoring:** AI-based qualification of potential customers
- **Conversion Tracking:** Monitor engagement and response rates

## 🛠 Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ResumeSendtoCompany                      │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + Vite)  │  Backend (Node.js + Express)    │
│  - Dashboard              │  - API Server                  │
│  - Analytics              │  - Job Queue (PM2)             │
│  - Campaign Management    │  - Email Engines               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Data Layer & Integrations                      │
├─────────────────────────────────────────────────────────────┤
│  SQLite Database          │  External APIs                 │
│  - Leads                  │  - Gemini AI                   │
│  - Campaigns              │  - Scraping Services           │
│  - Analytics              │  - Email Providers             │
│  - Logs                   │  - Verification APIs           │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack
- **Backend:** Node.js (Express.js)
- **Frontend:** React + Vite + Tailwind CSS
- **Database:** SQLite with custom ORM
- **Process Management:** PM2 with autonomous watchdog
- **AI Integration:** Google Gemini 1.5 Flash & OpenAI
- **Scraping:** ScraperAPI, ScrapingBee, ZenRows with fallbacks
- **Email Providers:** Gmail, Resend, Yandex, Brevo

## 📁 Project Structure

```
ResumeSendtoCompany/
├── app/                      # Main application directory
│   ├── server.js            # Express server
│   ├── db.js                # Database handler
│   ├── config.js            # Configuration loader
│   ├── send-engine.js       # Email sending engine
│   ├── scan-engine.js       # Lead discovery engine
│   ├── ai-advisor.js        # AI content generation
│   ├── verifier.js          # Email verification
│   ├── templates/           # Email templates
│   ├── tests/               # Unit tests
│   └── scripts/             # Utility scripts
├── frontend-new/            # React frontend
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Page components
│   │   └── hooks/          # Custom React hooks
│   └── package.json
├── assets/                 # Images and visual assets
│   ├── logo.svg           # Project logo
│   ├── demo-preview.svg   # Dashboard preview
│   └── opengraph-image.svg # Social preview
├── config/                 # Configuration files
├── data/                   # Runtime data (gitignored)
├── logs/                   # Application logs (gitignored)
├── ecosystem.config.cjs    # PM2 configuration
├── package.json
├── .env.example            # Environment variables template
└── README.md
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/semih-kilic/ResumeSendtoCompany.git
cd ResumeSendtoCompany
```

2. **Install dependencies**
```bash
npm install
cd frontend-new && npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

4. **Setup database**
```bash
npm run setup-db
```

5. **Start the application**
```bash
# Development mode
npm run dev

# Production mode with PM2
pm2 start ecosystem.config.cjs
pm2 logs canada-omega
```

## ⚙️ Configuration

### Environment Variables

Key environment variables in `.env`:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DB_PATH=./data/canada.db

# AI Services
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Email Providers
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Scraping Services
SCRAPER_API_KEY=your_scraper_api_key
SCRAPING_BEE_KEY=your_scraping_bee_key
```

### Configuration File

Detailed settings in `config.toml`:

```toml
[smtp_pool]
rotation_enabled = true
providers = ["gmail", "resend", "yandex", "brevo"]
rate_limit = 100  # emails per hour

[verification]
strict_mode = true
timeout = 30  # seconds

[scraping]
concurrent_requests = 5
timeout = 15  # seconds
fallback_enabled = true
```

## 📊 Usage Examples

### Starting a Campaign

```javascript
// Create a new campaign
const campaign = {
  name: "Tech Startup Outreach",
  target_industry: "SaaS",
  location: "Canada",
  email_template: "saas-pitch"
};

await createCampaign(campaign);
```

### Manual Lead Discovery

```bash
# Run lead discovery for specific region
npm run discover -- --region "Toronto" --industry "Technology"
```

### Email Verification

```javascript
// Verify email before sending
const result = await verifyEmail("contact@company.com");
console.log(result.valid, result.trust_score);
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --grep "email-engine"

# Run with coverage
npm test -- --coverage
```

## 📈 Monitoring & Analytics

### Dashboard Access
- **URL:** `http://localhost:3000`
- **Features:** Real-time statistics, campaign performance, email deliverability

### PM2 Monitoring
```bash
pm2 monit
pm2 logs canada-omega --lines 100
```

### Key Metrics
- **Email Sent Rate:** Number of emails sent per hour
- **Deliverability:** Percentage of emails reaching inbox
- **Response Rate:** Engagement from recipients
- **Lead Quality:** Score of discovered leads

## 🔒 Security Best Practices

1. **Never commit `.env` or `config.toml`** to version control
2. **Use environment variables** for all sensitive data
3. **Rotate API keys** regularly
4. **Monitor rate limits** to avoid provider blocks
5. **Enable SPF/DKIM/DMARC** for email domains
6. **Use VPN/proxy rotation** for scraping operations

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow existing code style
- Write tests for new features
- Update documentation
- Ensure all tests pass

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Google Gemini** for AI-powered content generation
- **Scraping service providers** for reliable data extraction
- **Open source community** for various libraries and tools

## 📞 Support

For support, email support@resumesendtocompany.com or open an issue in the GitHub repository.

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=semih-kilic/ResumeSendtoCompany&type=Date)](https://star-history.com/#semih-kilic/ResumeSendtoCompany&Date)

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/semih-kilic">Semih Kılıç</a></sub>
</div>