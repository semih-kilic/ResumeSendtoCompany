# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x.x | Yes |

## Reporting a vulnerability

Please do not publish credentials, personal data, or a reproducible security vulnerability in a public issue. If GitHub Private Vulnerability Reporting is enabled for this repository, use the **Report a vulnerability** option in the repository's **Security** tab. Otherwise, contact the repository maintainer privately through the GitHub profile associated with this project.

Include a short description, affected file or endpoint, reproduction steps, impact assessment, and a suggested mitigation when available. Please allow reasonable time for triage before public disclosure.

## Deployment guidance

This project can send email and connect to external providers. Before exposing it beyond a trusted local network, review the deployment configuration, protect the API behind authentication and a private network boundary, keep credentials outside Git, and use a dedicated test account or dry-run mode.

Never commit `.env`, `config.toml`, API keys, SMTP passwords, recipient exports, uploaded documents, database files, or logs containing personal data. Rotate any credential that is accidentally exposed.

## Dependency and data hygiene

Run the following checks before a release:

```bash
npm ci
npm audit
npm test
npm run lint
npm run frontend:build
```

Keep SQLite data and generated files in the ignored `data/` directory. Back up operational data securely and verify that backups do not contain credentials or unnecessary personal information.

## Scope

Security reports may cover the backend API, dashboard, file upload handling, email provider integrations, scraping integrations, AI provider data handling, dependency vulnerabilities, and accidental secret exposure.
