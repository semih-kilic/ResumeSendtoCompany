import { getProfileSummaryForEvaluation } from './candidate-profile.js';

/** Verdict labels aligned with ai-job-search thresholds */
export const FIT_VERDICTS = {
  STRONG: 'Strong Fit',
  GOOD: 'Good Fit',
  MODERATE: 'Moderate Fit',
  WEAK: 'Weak Fit',
  POOR: 'Poor Fit',
};

export function scoreToVerdict(overallScore) {
  if (overallScore >= 75) return FIT_VERDICTS.STRONG;
  if (overallScore >= 60) return FIT_VERDICTS.GOOD;
  if (overallScore >= 45) return FIT_VERDICTS.MODERATE;
  if (overallScore >= 30) return FIT_VERDICTS.WEAK;
  return FIT_VERDICTS.POOR;
}

/**
 * Heuristic fallback when AI is unavailable (no API cost, always-on).
 */
export function evaluateCompanyFitHeuristic({ companyName, website, emailType, websiteSnippet }) {
  let technical = 55;
  let experience = 60;
  let career = 55;
  let location = 100; // Canada-focused outreach

  const name = (companyName || '').toLowerCase();
  const snippet = (websiteSnippet || '').toLowerCase();
  const combined = `${name} ${snippet}`;

  const itKeywords = ['tech', 'software', 'it ', 'systems', 'cloud', 'digital', 'cyber', 'data', 'network', 'consulting', 'engineering'];
  const weakKeywords = ['restaurant', 'salon', 'retail', 'cleaning', 'plumbing'];

  if (itKeywords.some((k) => combined.includes(k))) {
    technical += 20;
    career += 15;
  }
  if (weakKeywords.some((k) => combined.includes(k))) {
    technical -= 25;
    career -= 20;
  }

  if (website) technical += 5;
  if (emailType === 'hr' || emailType === 'recruitment') career += 15;
  if (emailType === 'management') experience += 10;

  technical = clamp(technical);
  experience = clamp(experience);
  career = clamp(career);

  const overall = Math.round(technical * 0.3 + experience * 0.25 + career * 0.3 + 70 * 0.15);

  return {
    overallScore: overall,
    verdict: scoreToVerdict(overall),
    dimensions: {
      technicalSkills: technical,
      experienceMatch: experience,
      behavioralFit: 70,
      location: 'PASS',
      careerAlignment: career,
    },
    recommendation: overall >= 60 ? 'apply' : overall >= 45 ? 'apply_with_caveats' : 'skip',
    source: 'heuristic',
  };
}

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

/**
 * Full evaluation: AI when available, heuristic fallback otherwise.
 */
export async function evaluateCompanyFit(aiAdvisor, context) {
  const profile = getProfileSummaryForEvaluation();
  if (!profile) {
    return evaluateCompanyFitHeuristic(context);
  }

  if (aiAdvisor?.evaluateCompanyFit) {
    try {
      const aiResult = await aiAdvisor.evaluateCompanyFit(context, profile);
      if (aiResult?.overallScore != null) {
        return { ...aiResult, source: 'ai' };
      }
    } catch (err) {
      console.warn(`[JOB-FIT] AI evaluation failed: ${err.message}`);
    }
  }

  return evaluateCompanyFitHeuristic(context);
}
