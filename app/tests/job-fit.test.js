import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompanyFitHeuristic, scoreToVerdict, FIT_VERDICTS } from '../job-fit-evaluator.js';
import { getProfileSummaryForEvaluation } from '../candidate-profile.js';

test('scoreToVerdict maps ai-job-search thresholds', () => {
  assert.equal(scoreToVerdict(80), FIT_VERDICTS.STRONG);
  assert.equal(scoreToVerdict(65), FIT_VERDICTS.GOOD);
  assert.equal(scoreToVerdict(50), FIT_VERDICTS.MODERATE);
  assert.equal(scoreToVerdict(35), FIT_VERDICTS.WEAK);
  assert.equal(scoreToVerdict(10), FIT_VERDICTS.POOR);
});

test('heuristic prefers IT companies over unrelated sectors', () => {
  const tech = evaluateCompanyFitHeuristic({
    companyName: 'CloudTech Systems Inc',
    website: 'https://cloudtech.ca',
    emailType: 'hr',
    websiteSnippet: 'enterprise cloud infrastructure and IT consulting',
  });
  const retail = evaluateCompanyFitHeuristic({
    companyName: 'Joe Restaurant Group',
    website: null,
    emailType: 'info',
    websiteSnippet: 'family dining and catering',
  });

  assert.ok(tech.overallScore > retail.overallScore);
  assert.equal(tech.recommendation, 'apply');
});

test('candidate profile loads from cv-profile.json', () => {
  const summary = getProfileSummaryForEvaluation();
  assert.ok(summary);
  assert.ok(summary.name);
  assert.ok(Array.isArray(summary.competencies));
  assert.ok(summary.competencies.length > 0);
});
