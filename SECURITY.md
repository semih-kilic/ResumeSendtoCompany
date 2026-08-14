# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in ResumeSendtoCompany, please report it responsibly.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please send an email to: [security@resumesendtocompany.com](mailto:security@resumesendtocompany.com)

Include the following information in your report:
- A description of the vulnerability
- Steps to reproduce the vulnerability
- Potential impact of the vulnerability
- Any suggested fixes or mitigations

### What to Expect

- We will acknowledge receipt of your report within 48 hours
- We will provide a detailed response within 7 days
- We will work with you to understand and resolve the issue
- We will notify you when the issue has been fixed
- We will credit you in the release notes (unless you prefer to remain anonymous)

### Security Best Practices

When using ResumeSendtoCompany, please follow these security best practices:

1. **Never commit sensitive data**
   - Do not commit `.env` files
   - Do not commit `config.toml` with real credentials
   - Do not commit API keys, passwords, or tokens

2. **Use environment variables**
   - Store sensitive configuration in environment variables
   - Use secret management services in production
   - Rotate credentials regularly

3. **Keep dependencies updated**
   - Regularly update dependencies
   - Use `npm audit` to check for vulnerabilities
   - Apply security patches promptly

4. **Secure your database**
   - Use strong database passwords
   - Enable database encryption if available
   - Regular database backups

5. **Email security**
   - Use SPF, DKIM, and DMARC for email domains
   - Monitor email deliverability
   - Use secure SMTP connections (TLS)

### Dependency Security

We regularly audit our dependencies for known vulnerabilities. You can check the security status of our dependencies by running:

```bash
npm audit
```

If you find a security vulnerability in any of our dependencies, please report it following the same process.

### Security Features

ResumeSendtoCompany includes several security features:

- **Input validation**: All user inputs are validated and sanitized
- **SQL injection protection**: Parameterized queries are used for database operations
- **XSS protection**: Content is properly escaped when rendering user input
- **Rate limiting**: API endpoints are rate-limited to prevent abuse
- **Authentication**: Secure authentication mechanisms are implemented
- **Encryption**: Sensitive data is encrypted at rest when possible

## Security Updates

Security updates will be announced through:
- GitHub Security Advisories
- Release notes
- Security email list (subscribe by emailing security-subscribe@resumesendtocompany.com)

We recommend subscribing to security notifications to stay informed about important security updates.

## Responsible Disclosure

We appreciate responsible security disclosures and will work with researchers to:
- Understand the issue
- Develop a fix
- Coordinate disclosure to minimize user impact
- Credit researchers for their contributions

Thank you for helping keep ResumeSendtoCompany and our users safe!