export class SmartSelector {
  constructor(config = {}) {
    this.qualityWeight = config.quality_weight ?? 0.8;
    this.costWeight = config.cost_weight ?? 0.2;
    this.lookbackHours = config.lookback_hours ?? 24;
    this.refreshIntervalMs = (config.refresh_interval_secs ?? 3600) * 1000;
    this._db = null;
    this._lastRefresh = 0;
    this._scores = {};
  }

  init(db) {
    this._db = db;
  }

  _refreshScores() {
    if (!this._db) return;
    const now = Date.now();
    if (now - this._lastRefresh < this.refreshIntervalMs) return;

    try {
      const since = `datetime('now', '-${this.lookbackHours} hours')`;
      const rows = this._db.prepare(`
        SELECT provider, action,
               COUNT(*) as total,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
               SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed,
               SUM(cost) as totalCost
        FROM provider_usage
        WHERE created_at >= ${since}
        GROUP BY provider, action
      `).all();

      this._scores = {};
      let maxAvgCost = 0;
      const entries = [];

      for (const row of rows) {
        const successRate = row.total > 0 ? row.success / row.total : 0;
        const avgCost = row.total > 0 ? row.totalCost / row.total : 0;
        if (avgCost > maxAvgCost) maxAvgCost = avgCost;
        entries.push({ ...row, successRate, avgCost });
      }

      for (const row of entries) {
        const normalizedCost = maxAvgCost > 0 ? row.avgCost / maxAvgCost : 0;
        const score = (this.qualityWeight * row.successRate) - (this.costWeight * normalizedCost);
        const safeScore = Math.max(0, Math.min(1, score));
        if (!this._scores[row.action]) this._scores[row.action] = {};
        this._scores[row.action][row.provider] = {
          score: safeScore,
          successRate: Math.round(row.successRate * 100),
          avgCost: row.avgCost,
          total: row.total,
        };
      }

      this._lastRefresh = now;
      console.info(`[SMART-SELECTOR] Refreshed scores for ${Object.keys(this._scores).length} action groups`);
    } catch (e) {
      console.error(`[SMART-SELECTOR] Refresh error: ${e.message}`);
    }
  }

  forceRefresh() {
    this._lastRefresh = 0;
    this._refreshScores();
  }

  getRankedProviders(action, providerList) {
    this._refreshScores();
    const actionScores = this._scores[action] || {};

    return [...providerList].sort((a, b) => {
      const aName = typeof a === 'string' ? a : (a.name || a);
      const bName = typeof b === 'string' ? b : (b.name || b);
      const sa = actionScores[aName]?.score ?? this.qualityWeight * 0.9;
      const sb = actionScores[bName]?.score ?? this.qualityWeight * 0.9;
      return sb - sa;
    });
  }

  getScore(provider, action) {
    this._refreshScores();
    return this._scores[action]?.[provider] || null;
  }

  getScores() {
    this._refreshScores();
    return this._scores;
  }
}

export default SmartSelector;
