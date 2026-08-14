import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedProfile = null;

/**
 * Structured candidate profile (inspired by ai-job-search 01-candidate-profile.md).
 * Loaded from backend/config/cv-profile.json.
 */
export function loadCandidateProfile() {
  if (cachedProfile) return cachedProfile;

  const profilePath = path.join(__dirname, 'config', 'cv-profile.json');
  if (!fs.existsSync(profilePath)) {
    return null;
  }

  cachedProfile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  return cachedProfile;
}

export function getProfileSummaryForEvaluation() {
  const p = loadCandidateProfile();
  if (!p) return null;

  const competencies = p.COMPETENCIES_LIST || [];
  const experience = (p.EXPERIENCE_LIST || []).map((e) => `${e.role} @ ${e.company}`).join('; ');
  const certs = (p.CERTIFICATIONS_LIST || []).map((c) => c.title).join(', ');

  return {
    name: p.NAME,
    location: p.LOCATION,
    summary: p.SUMMARY_TEXT,
    competencies,
    experience,
    certifications: certs,
    careerGoals: [
      'IT Systems Administrator / Infrastructure roles in Canada',
      'Enterprise M365, Azure, security, and operational excellence',
      'Organizations valuing stability, SLA delivery, and hands-on ownership',
    ],
    energizingTasks: [
      'Infrastructure stabilization and backlog elimination',
      'Cloud migration and identity management',
      'Automation and security hardening',
    ],
    drainingTasks: [
      'Pure sales-only roles without technical depth',
      'Roles requiring relocation outside Canada',
    ],
  };
}

export function clearCandidateProfileCache() {
  cachedProfile = null;
}
