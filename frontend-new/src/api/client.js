const BASE = '';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

const api = {
  // Health
  health: () => request('/api/health'),

  // Stats
  getStats: () => request('/api/stats'),

  // Scan
  getScanStatus: () => request('/api/scan/status'),
  startScan: (body) => request('/api/scan/start', { method: 'POST', body: JSON.stringify(body || {}) }),
  stopScan: () => request('/api/scan/stop', { method: 'POST' }),

  // Emails
  getEmails: (params) => request(`/api/emails?${new URLSearchParams(params).toString()}`),
  toggleExclude: (id) => request(`/api/emails/${id}/toggle-exclude`, { method: 'POST' }),
  exportCSV: async (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    const res = await fetch(`${BASE}/api/emails/export?${qs}`);
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },

  // Applications
  getApplications: (params) => request(`/api/applications?${new URLSearchParams(params).toString()}`),
  updateApplicationStatus: (email, status) =>
    request(`/api/applications/${encodeURIComponent(email)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Fit
  getFitStats: () => request('/api/fit/stats'),

  // Campaign
  getCampaignStatus: () => request('/api/campaign/status'),
  startCampaign: (body) => request('/api/campaign/start', { method: 'POST', body: JSON.stringify(body || {}) }),
  stopCampaign: () => request('/api/campaign/stop', { method: 'POST' }),
  uploadResume: async (file) => {
    const fd = new FormData();
    fd.append('resume', file);
    const res = await fetch(`${BASE}/api/campaign/upload-resume`, { method: 'POST', body: fd });
    return res.json();
  },

  // SaaS
  getSaaSStatus: () => request('/api/saas/status'),
  startSaaS: (body) => request('/api/saas/start', { method: 'POST', body: JSON.stringify(body || {}) }),
  stopSaaS: () => request('/api/saas/stop', { method: 'POST' }),
  getSaaSHistory: () => request('/api/saas/history'),

  // Replies
  getReplies: () => request('/api/replies'),

  // Settings
  getSettings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  testSmtp: () => request('/api/settings/test-smtp', { method: 'POST' }),

  // Template
  getTemplate: () => request('/api/template'),
  saveTemplate: (content) => request('/api/template', { method: 'PUT', body: JSON.stringify({ content }) }),
  getSaasTemplate: () => request('/api/template/saas'),
  saveSaasTemplate: (content) => request('/api/template/saas', { method: 'PUT', body: JSON.stringify({ content }) }),

  // Analytics
  getAnalytics: (period) => request(`/api/analytics?period=${period || '24h'}`),
  getAnalyticsProviders: () => request('/api/analytics/providers'),
  getAnalyticsActions: () => request('/api/analytics/actions'),

  // Provider Health
  getProviderStatus: () => request('/api/provider-status'),
  getProviderGroups: () => request('/api/provider-groups'),
  getSelectorScores: () => request('/api/selector/scores'),
  getDLQ: (params) => request(`/api/dlq/items?${new URLSearchParams(params || {}).toString()}`),

  // Notifications
  getNotifications: () => request('/api/notifications'),
  getUnreadCount: () => request('/api/notifications/unread-count'),
  markAllRead: () => request('/api/notifications/read-all', { method: 'POST' }),
};

export default api;
