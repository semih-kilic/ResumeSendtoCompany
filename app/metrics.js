let _db = null;

export function initMetrics(db) {
  _db = db;
}

const COST_ESTIMATES = {
  scraperapi: 0.003,
  scrapingbee: 0.002,
  zenrows: 0.002,
  reoon: 0.004,
  mailboxvalidator: 0.001,
  resend: 0.0003,
  gemini: 0.0015,
  openai: 0.003,
};

export function logProviderUsage({ provider, action, status, durationMs, target, error }) {
  if (!_db) return;
  const cost = status === 'success' ? (COST_ESTIMATES[provider] || 0) : 0;
  try {
    _db.prepare(`
      INSERT INTO provider_usage (provider, action, status, duration_ms, cost, target, error_message, created_at)
      VALUES (@provider, @action, @status, @durationMs, @cost, @target, @error, datetime('now'))
    `).run({ provider, action, status, durationMs: durationMs || null, cost, target: target || null, error: error || null });
  } catch (e) {
    console.error(`[METRICS] Failed to log: ${e.message}`);
  }
}

export function getAnalyticsSummary(period = '24h') {
  if (!_db) return { totals: { total: 0, success: 0, failed: 0, totalCost: 0 }, byProvider: [], byAction: [], byProviderAction: [], usageByDay: [] };

  const since = period === '7d' ? "datetime('now', '-7 days')" : period === '30d' ? "datetime('now', '-30 days')" : "datetime('now', '-24 hours')";

  const byProvider = _db.prepare(`
    SELECT provider,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed,
           ROUND(AVG(CASE WHEN status = 'success' THEN duration_ms ELSE NULL END)) as avgDurationMs,
           SUM(cost) as totalCost
    FROM provider_usage
    WHERE created_at >= ${since}
    GROUP BY provider
    ORDER BY total DESC
  `).all();

  const byAction = _db.prepare(`
    SELECT action,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed
    FROM provider_usage
    WHERE created_at >= ${since}
    GROUP BY action
    ORDER BY total DESC
  `).all();

  const byProviderAction = _db.prepare(`
    SELECT provider, action,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
           ROUND(AVG(CASE WHEN status = 'success' THEN duration_ms ELSE NULL END)) as avgDurationMs
    FROM provider_usage
    WHERE created_at >= ${since}
    GROUP BY provider, action
    ORDER BY provider, action
  `).all();

  const usageByDay = _db.prepare(`
    SELECT DATE(created_at) as day,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed
    FROM provider_usage
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY day
  `).all();

  const totals = _db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed,
           SUM(cost) as totalCost
    FROM provider_usage
    WHERE created_at >= ${since}
  `).get();

  return {
    totals,
    byProvider: byProvider.map(p => ({
      ...p,
      successRate: p.total > 0 ? Math.round((p.success / p.total) * 100) : 0,
    })),
    byAction,
    byProviderAction,
    usageByDay,
  };
}

export default { initMetrics, logProviderUsage, getAnalyticsSummary };
