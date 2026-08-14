import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Singleton browser instance — reused across all PDF generations
let _browserInstance = null;
let _browserLaunchPromise = null;

async function getSharedBrowser() {
  if (_browserInstance) {
    try {
      // Verify browser is still alive
      await _browserInstance.version();
      return _browserInstance;
    } catch {
      _browserInstance = null;
      _browserLaunchPromise = null;
    }
  }
  if (!_browserLaunchPromise) {
    _browserLaunchPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }).then(browser => {
      _browserInstance = browser;
      browser.on('disconnected', () => {
        _browserInstance = null;
        _browserLaunchPromise = null;
      });
      return browser;
    });
  }
  return _browserLaunchPromise;
}

export class PdfEngine {
  constructor() {
    this.templateContent = null;
  }

  async loadTemplate() {
    const templatePath = path.join(__dirname, '..', 'templates', 'cv-template.html');
    this.templateContent = await fs.readFile(templatePath, 'utf8');
  }

  /**
   * Replaces placeholders in the HTML with profile data
   */
  _bindData(profileData) {
    let html = this.templateContent;
    
    // Convert arrays to HTML before binding
    const bindableObj = { ...profileData };
    
    // Build Competencies
    if (Array.isArray(profileData.COMPETENCIES_LIST)) {
      bindableObj.COMPETENCIES = profileData.COMPETENCIES_LIST.map(c => 
        `<span class="competency-tag">${c}</span>`
      ).join('');
    }

    // Build Experience
    if (Array.isArray(profileData.EXPERIENCE_LIST)) {
      bindableObj.EXPERIENCE = profileData.EXPERIENCE_LIST.map(job => `
        <div class="job avoid-break">
          <div class="job-header">
            <span class="job-company">${job.company}</span>
            <span class="job-period">${job.period}</span>
          </div>
          <div class="job-role">${job.role}</div>
          <div class="job-location">${job.location}</div>
          <ul>
            ${job.bullets.map(b => `<li>${b}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }

    // Build Projects
    if (Array.isArray(profileData.PROJECTS_LIST)) {
      bindableObj.PROJECTS = profileData.PROJECTS_LIST.map(proj => `
        <div class="project avoid-break">
          <div>
            <span class="project-title">${proj.title}</span>
            ${proj.badge ? `<span class="project-badge">${proj.badge}</span>` : ''}
          </div>
          <div class="project-desc">${proj.description}</div>
          <div class="project-tech">${proj.tech}</div>
        </div>
      `).join('');
    }

    // Build Education
    if (Array.isArray(profileData.EDUCATION_LIST)) {
      bindableObj.EDUCATION = profileData.EDUCATION_LIST.map(edu => `
        <div class="edu-item">
          <div class="edu-header">
            <span class="edu-title">${edu.degree}</span>
            <span class="edu-year">${edu.year}</span>
          </div>
          <div class="edu-org">${edu.organization}</div>
          <div class="edu-desc">${edu.description || ''}</div>
        </div>
      `).join('');
    }
    
    // Build Certifications
     if (Array.isArray(profileData.CERTIFICATIONS_LIST)) {
      bindableObj.CERTIFICATIONS = profileData.CERTIFICATIONS_LIST.map(cert => `
        <div class="cert-item">
          <div><span class="cert-title">${cert.title}</span> | <span class="cert-org">${cert.organization}</span></div>
          <span class="cert-year">${cert.year}</span>
        </div>
      `).join('');
    }

    // Build Skills
    if (Array.isArray(profileData.SKILLS_LIST)) {
      bindableObj.SKILLS = profileData.SKILLS_LIST.map(skill => `
        <div class="skill-item">
          <span class="skill-category">${skill.category}:</span> ${skill.items}
        </div>
      `).join('');
    }
    
    // Resolve font paths
    const fontsDir = path.join(__dirname, 'fonts').replace(/\\/g, '/');
    html = html.replace(/url\(['"]?\.\/fonts\//g, `url('file:///${fontsDir}/`);
    html = html.replace(/file:\/\/\/([^'")]+)\.woff2['"]\)/g, `file:///$1.woff2')`);

    // Replace all placeholders
    for (const [key, value] of Object.entries(bindableObj)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, value);
    }
    
    // Clear out any {{UNUSED}} tags
    html = html.replace(/{{[A-Z_]+}}/g, '');

    return html;
  }

  async generatePdfBuffer(profileData) {
    if (!this.templateContent) {
      await this.loadTemplate();
    }

    const htmlContent = this._bindData(profileData);
    const browser = await getSharedBrowser();
    const page = await browser.newPage();

    try {
      const templatesDir = path.join(__dirname, '..', 'templates').replace(/\\/g, '/');
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0',
        baseURL: `file:///${templatesDir}/`
      });

      await page.evaluateHandle('document.fonts.ready');

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' }
      });

      return pdfBuffer;
    } catch (e) {
      console.error('[PDF-ENGINE] Failed to generate PDF:', e.message);
      throw e;
    } finally {
      await page.close();
    }
  }
}
