import { loadCandidateProfile, getProfileSummaryForEvaluation } from './candidate-profile.js';

/** Canada IT Systems Administrator market demand (heuristic baseline). */
export const MARKET_DEMAND_SKILLS = [
  { skill: 'Microsoft 365 Administration', category: 'Cloud & Identity', priority: 'high' },
  { skill: 'Azure AD / Entra ID', category: 'Cloud & Identity', priority: 'high' },
  { skill: 'Windows Server & Active Directory', category: 'Infrastructure', priority: 'high' },
  { skill: 'PowerShell Automation', category: 'Automation', priority: 'high' },
  { skill: 'Endpoint Management (Intune)', category: 'Cloud & Identity', priority: 'medium' },
  { skill: 'SharePoint Online', category: 'Collaboration', priority: 'medium' },
  { skill: 'VMware / Hyper-V Virtualization', category: 'Infrastructure', priority: 'medium' },
  { skill: 'Network Security & Firewall', category: 'Security', priority: 'high' },
  { skill: 'ITIL Service Management', category: 'Operations', priority: 'medium' },
  { skill: 'Incident & Ticket Management', category: 'Operations', priority: 'high' },
  { skill: 'Backup & Disaster Recovery', category: 'Infrastructure', priority: 'medium' },
  { skill: 'Azure Fundamentals', category: 'Cloud & Identity', priority: 'medium' },
  { skill: 'Python Scripting', category: 'Automation', priority: 'low' },
  { skill: 'Docker / Containers', category: 'DevOps', priority: 'low' },
  { skill: 'SIEM / Security Monitoring', category: 'Security', priority: 'low' },
];

const SKILL_ALIASES = {
  'Microsoft 365 Administration': ['m365', 'microsoft 365', 'office 365', 'o365'],
  'Azure AD / Entra ID': ['entra', 'azure ad', 'azure identity', 'aad'],
  'Windows Server & Active Directory': ['active directory', 'windows server', 'ad ds', 'domain controller'],
  'PowerShell Automation': ['powershell', 'ps1', 'scripting'],
  'Endpoint Management (Intune)': ['intune', 'endpoint manager', 'mdm'],
  'SharePoint Online': ['sharepoint', 'spo'],
  'VMware / Hyper-V Virtualization': ['vmware', 'hyper-v', 'esxi', 'virtualization'],
  'Network Security & Firewall': ['firewall', 'sophos', 'vpn', 'network security', 'mfa'],
  'ITIL Service Management': ['itil', 'service desk', 'sla'],
  'Incident & Ticket Management': ['ticket', 'incident', 'servicenow', 'backlog'],
  'Backup & Disaster Recovery': ['backup', 'disaster recovery', 'dr ', 'veeam'],
  'Azure Fundamentals': ['az-900', 'azure fundamentals', 'azure cloud'],
  'Python Scripting': ['python'],
  'Docker / Containers': ['docker', 'kubernetes', 'k8s', 'container'],
  'SIEM / Security Monitoring': ['siem', 'soc', 'security monitoring', 'ceh'],
};

export function getProfileSkills() {
  const profile = loadCandidateProfile();
  if (!profile) return null;

  const fromCompetencies = profile.COMPETENCIES_LIST || [];
  const fromSkills = (profile.SKILLS_LIST || []).flatMap((s) =>
    String(s.items || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)
  );
  const fromCerts = (profile.CERTIFICATIONS_LIST || []).map((c) => c.title);

  return {
    name: profile.NAME,
    location: profile.LOCATION,
    summary: profile.SUMMARY_TEXT,
    competencies: fromCompetencies,
    skills: [...new Set([...fromCompetencies, ...fromSkills])],
    certifications: fromCerts,
    experience: (profile.EXPERIENCE_LIST || []).map((e) => ({
      role: e.role,
      company: e.company,
      period: e.period,
    })),
  };
}

function normalize(text) {
  return (text || '').toLowerCase();
}

function profileHasSkill(profileText, skillName) {
  const aliases = SKILL_ALIASES[skillName] || [skillName.toLowerCase()];
  return aliases.some((a) => profileText.includes(a));
}

function extractSkillsFromJobText(text) {
  const lower = normalize(text);
  const found = [];
  for (const item of MARKET_DEMAND_SKILLS) {
    const aliases = SKILL_ALIASES[item.skill] || [item.skill.toLowerCase()];
    if (aliases.some((a) => lower.includes(a))) {
      found.push(item);
    }
  }
  return found;
}

/**
 * Heuristic skill gap analysis — always available, zero API cost.
 */
export function analyzeSkillGapsHeuristic({ targetRole, jobDescription } = {}) {
  const profileData = getProfileSkills();
  if (!profileData) {
    return { error: 'No candidate profile found. Add backend/config/cv-profile.json.' };
  }

  const profileText = normalize([
    profileData.summary,
    ...profileData.skills,
    ...profileData.certifications,
    ...(profileData.experience || []).map((e) => `${e.role} ${e.company}`),
  ].join(' '));

  let demandSkills = [...MARKET_DEMAND_SKILLS];

  if (jobDescription?.trim()) {
    const jdSkills = extractSkillsFromJobText(jobDescription);
    if (jdSkills.length > 0) {
      const jdNames = new Set(jdSkills.map((s) => s.skill));
      demandSkills = [
        ...jdSkills.map((s) => ({ ...s, priority: 'high', source: 'job_description' })),
        ...MARKET_DEMAND_SKILLS.filter((s) => !jdNames.has(s.skill)),
      ];
    }
  }

  const matched = [];
  const gaps = [];

  for (const item of demandSkills) {
    const has = profileHasSkill(profileText, item.skill);
    const entry = {
      skill: item.skill,
      category: item.category,
      priority: item.priority,
      status: has ? 'strong' : 'gap',
      proficiency: has ? estimateProficiency(profileText, item.skill) : 'none',
    };
    if (has) matched.push(entry);
    else gaps.push(entry);
  }

  const coverageScore = Math.round((matched.length / demandSkills.length) * 100);

  const gapsByPriority = {
    high: gaps.filter((g) => g.priority === 'high'),
    medium: gaps.filter((g) => g.priority === 'medium'),
    low: gaps.filter((g) => g.priority === 'low'),
  };

  return {
    targetRole: targetRole || 'IT Systems Administrator (Canada)',
    coverageScore,
    matched,
    gaps,
    gapsByPriority,
    strengths: matched.filter((m) => m.proficiency === 'advanced').map((m) => m.skill).slice(0, 8),
    learningPlan: buildLearningPlan(gapsByPriority),
    source: 'heuristic',
    profileSummary: {
      name: profileData.name,
      location: profileData.location,
      skillCount: profileData.skills.length,
      certCount: profileData.certifications.length,
    },
  };
}

function estimateProficiency(profileText, skillName) {
  const aliases = SKILL_ALIASES[skillName] || [skillName.toLowerCase()];
  const hit = aliases.find((a) => profileText.includes(a));
  if (!hit) return 'none';

  const advancedSignals = ['14+', 'senior', 'manager', 'led', 'sole', 'migrated', 'certified', 'mcsa', 'itil', 'az-900', 'ceh'];
  if (advancedSignals.some((s) => profileText.includes(s))) return 'advanced';
  return 'intermediate';
}

function buildLearningPlan(gapsByPriority) {
  const plan = [];

  const resources = {
    'Azure AD / Entra ID': { action: 'Complete MS-102 or Entra ID admin labs', hours: 20 },
    'Endpoint Management (Intune)': { action: 'Microsoft Learn: Endpoint Administrator path', hours: 25 },
    'Microsoft 365 Administration': { action: 'Hands-on M365 tenant admin sandbox', hours: 15 },
    'Docker / Containers': { action: 'Docker fundamentals + deploy a small app', hours: 12 },
    'SIEM / Security Monitoring': { action: 'Try Microsoft Sentinel free tier labs', hours: 18 },
    'Python Scripting': { action: 'Automate 3 IT tasks (AD reports, log parsing)', hours: 10 },
    'SharePoint Online': { action: 'Build team site + permissions model', hours: 8 },
  };

  for (const gap of [...gapsByPriority.high, ...gapsByPriority.medium].slice(0, 6)) {
    const res = resources[gap.skill] || {
      action: `Study ${gap.skill} via vendor docs + lab project`,
      hours: gap.priority === 'high' ? 15 : 10,
    };
    plan.push({
      skill: gap.skill,
      priority: gap.priority,
      action: res.action,
      estimatedHours: res.hours,
      week: plan.length < 3 ? 1 : plan.length < 5 ? 2 : 3,
    });
  }

  return plan;
}

/**
 * Full analysis: AI enrichment when available, heuristic fallback.
 */
export async function analyzeSkillGaps(aiAdvisor, options = {}) {
  const base = analyzeSkillGapsHeuristic(options);
  if (base.error) return base;

  const profile = getProfileSummaryForEvaluation();
  if (!profile || !aiAdvisor?.analyzeSkillGaps) {
    return base;
  }

  try {
    const aiResult = await aiAdvisor.analyzeSkillGaps(options, profile, base);
    if (aiResult?.coverageScore != null) {
      const merged = { ...base, ...aiResult, source: 'ai' };
      if (Array.isArray(aiResult.gaps) && !aiResult.gapsByPriority) {
        merged.gapsByPriority = {
          high: aiResult.gaps.filter((g) => g.priority === 'high'),
          medium: aiResult.gaps.filter((g) => g.priority === 'medium'),
          low: aiResult.gaps.filter((g) => g.priority === 'low'),
        };
      }
      if (!merged.learningPlan?.length && aiResult.learningPlan?.length) {
        merged.learningPlan = aiResult.learningPlan;
      }
      return merged;
    }
  } catch (err) {
    console.warn(`[UPSKILL] AI analysis failed: ${err.message}`);
  }

  return base;
}

export function getMarketSnapshot() {
  return {
    role: 'IT Systems Administrator (Canada)',
    demandSkills: MARKET_DEMAND_SKILLS,
    categories: [...new Set(MARKET_DEMAND_SKILLS.map((s) => s.category))],
    highPriorityCount: MARKET_DEMAND_SKILLS.filter((s) => s.priority === 'high').length,
  };
}
