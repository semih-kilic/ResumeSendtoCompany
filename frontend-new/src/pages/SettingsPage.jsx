import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Settings, Save, TestTube, CheckCircle, XCircle, Plus, Trash2, Mail, Key, Shield, Zap, Bell, Server } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', readOnly }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={onChange ? ((e) => onChange(e.target.value)) : undefined}
      placeholder={placeholder}
      readOnly={readOnly}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-sm text-slate-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-700'}`}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </label>
  );
}

function SmtpPoolCard({ item, index, onChange, onRemove }) {
  const update = (key, val) => {
    const updated = { ...item, [key]: val };
    onChange(index, updated);
  };
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-400">SMTP #{index + 1}</span>
        <button onClick={() => onRemove(index)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Host"><TextInput value={item.host} onChange={(v) => update('host', v)} /></Field>
        <Field label="Port"><TextInput value={item.port} onChange={(v) => update('port', parseInt(v) || 465)} /></Field>
        <Field label="Username"><TextInput value={item.username} onChange={(v) => update('username', v)} /></Field>
        <Field label="Password"><TextInput type="password" value={item.password} onChange={(v) => update('password', v)} placeholder="••••••••" /></Field>
        <Field label="From Email"><TextInput value={item.from_email || ''} onChange={(v) => update('from_email', v)} /></Field>
        <Field label="TLS">
          <button type="button" onClick={() => update('tls', !item.tls)}
            className={`mt-2 px-3 py-1 rounded text-xs font-semibold ${item.tls ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
            {item.tls ? 'Enabled' : 'Disabled'}
          </button>
        </Field>
      </div>
      {(item.saas_from_name || item.saas_from_email) && (
        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-700">
          <Field label="SaaS From Name"><TextInput value={item.saas_from_name || ''} onChange={(v) => update('saas_from_name', v)} /></Field>
          <Field label="SaaS From Email"><TextInput value={item.saas_from_email || ''} onChange={(v) => update('saas_from_email', v)} /></Field>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [form, setForm] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [activeTab, setActiveTab] = useState('smtp');

  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  useEffect(() => { if (data) setForm(data); }, [data]);

  const saveMut = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => setTestResult({ success: true, message: 'Settings saved successfully!' }),
    onError: (err) => setTestResult({ success: false, message: err.message }),
  });

  const testMut = useMutation({
    mutationFn: api.testSmtp,
    onSuccess: (res) => setTestResult(res),
    onError: (err) => setTestResult({ success: false, message: err.message }),
  });

  if (isLoading) return <LoadingSpinner text="Loading settings..." />;

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateNested = (key, subKey, value) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], [subKey]: value } }));

  const addPoolItem = (poolKey) => {
    const pool = [...(form[poolKey] || []), { host: 'smtp.gmail.com', port: 465, username: '', password: '', tls: true }];
    update(poolKey, pool);
  };
  const removePoolItem = (poolKey, idx) => {
    update(poolKey, form[poolKey].filter((_, i) => i !== idx));
  };
  const updatePoolItem = (poolKey, idx, item) => {
    const pool = [...form[poolKey]];
    pool[idx] = item;
    update(poolKey, pool);
  };

  const tabs = [
    { key: 'smtp', label: 'SMTP & Sending', icon: Mail },
    { key: 'api', label: 'API Keys', icon: Key },
    { key: 'ai', label: 'AI & Features', icon: Zap },
    { key: 'sending', label: 'Sending Limits', icon: Shield },
    { key: 'saas', label: 'SaaS Config', icon: Server },
    { key: 'notif', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="fade-in">
      <PageHeader title="Settings" subtitle="Configure all application settings.">
        <button
          onClick={() => saveMut.mutate(form)}
          disabled={saveMut.isPending}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save size={16} />
          {saveMut.isPending ? 'Saving...' : 'Save All'}
        </button>
      </PageHeader>

      {testResult && (
        <div className={`mb-6 flex items-center gap-3 px-4 py-3 rounded-lg text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {testResult.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {testResult.message}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-[#111827] border border-slate-800 rounded-lg p-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${activeTab === t.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* SMTP Tab */}
      {activeTab === 'smtp' && (
        <div className="space-y-6">
          <Section title="Primary SMTP" icon={Mail}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Host"><TextInput value={form.smtp_host} onChange={(v) => update('smtp_host', v)} /></Field>
              <Field label="Port"><TextInput value={form.smtp_port} onChange={(v) => update('smtp_port', parseInt(v) || 465)} /></Field>
              <Field label="Username"><TextInput value={form.smtp_username} onChange={(v) => update('smtp_username', v)} /></Field>
              <Field label="Password"><TextInput type="password" value={form.smtp_password} onChange={(v) => update('smtp_password', v)} placeholder="••••••••" /></Field>
              <Field label="From Name"><TextInput value={form.smtp_from_name} onChange={(v) => update('smtp_from_name', v)} /></Field>
              <Field label="From Email"><TextInput value={form.smtp_from_email} onChange={(v) => update('smtp_from_email', v)} /></Field>
            </div>
            <div className="flex items-center gap-4 mt-4">
              <Toggle checked={form.smtp_tls} onChange={(v) => update('smtp_tls', v)} label="TLS" />
              <button onClick={() => testMut.mutate()} disabled={testMut.isPending}
                className="flex items-center gap-2 bg-amber-500/15 text-amber-400 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50">
                <TestTube size={16} />
                {testMut.isPending ? 'Testing...' : 'Test Primary SMTP'}
              </button>
            </div>
          </Section>

          <Section title="SMTP Pool (Rotation)" icon={Server}>
            {(form.smtp_pool || []).map((item, i) => (
              <SmtpPoolCard key={item.id || i} item={item} index={i}
                onChange={(idx, updated) => updatePoolItem('smtp_pool', idx, updated)}
                onRemove={(idx) => removePoolItem('smtp_pool', idx)} />
            ))}
            <button onClick={() => addPoolItem('smtp_pool')}
              className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-semibold mt-2">
              <Plus size={14} /> Add SMTP Account
            </button>
          </Section>

          <Section title="SaaS SMTP Pool" icon={Server}>
            {(form.saas_smtp_pool || []).map((item, i) => (
              <SmtpPoolCard key={i} item={item} index={i}
                onChange={(idx, updated) => updatePoolItem('saas_smtp_pool', idx, updated)}
                onRemove={(idx) => removePoolItem('saas_smtp_pool', idx)} />
            ))}
            <button onClick={() => addPoolItem('saas_smtp_pool')}
              className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-semibold mt-2">
              <Plus size={14} /> Add SaaS SMTP Account
            </button>
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700">
              <Field label="SaaS From Name"><TextInput value={form.saas_from_name} onChange={(v) => update('saas_from_name', v)} /></Field>
              <Field label="SaaS From Email"><TextInput value={form.saas_from_email} onChange={(v) => update('saas_from_email', v)} /></Field>
            </div>
          </Section>
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'api' && (
        <div className="space-y-6">
          <Section title="AI Provider Keys" icon={Key}>
            <div className="space-y-4">
              <Field label="Gemini API Key">
                <TextInput type="password" value={form.gemini_api_key} onChange={(v) => update('gemini_api_key', v)} placeholder="••••••••" />
              </Field>
              <Field label="OpenAI API Key">
                <TextInput type="password" value={form.openai_api_key} onChange={(v) => update('openai_api_key', v)} placeholder="••••••••" />
              </Field>
              <Field label="Nvidia NIM API Key">
                <TextInput type="password" value={form.nvidia_api_key} onChange={(v) => update('nvidia_api_key', v)} placeholder="••••••••" />
              </Field>
            </div>
          </Section>

          <Section title="Email Service Keys" icon={Mail}>
            <div className="space-y-4">
              <Field label="Resend API Key">
                <TextInput type="password" value={form.resend_api_key} onChange={(v) => update('resend_api_key', v)} placeholder="••••••••" />
              </Field>
              <Field label="Resend From Email">
                <TextInput value={form.resend_from_email} onChange={(v) => update('resend_from_email', v)} />
              </Field>
            </div>
          </Section>

          <Section title="Scraper API Keys" icon={Key}>
            <div className="space-y-4">
              <Field label="ScraperAPI Key">
                <TextInput type="password" value={form.scraperapi_key} onChange={(v) => update('scraperapi_key', v)} placeholder="Optional" />
              </Field>
            </div>
          </Section>

          <Section title="Verification" icon={Shield}>
            <div className="space-y-4">
              <Field label="Verification Provider">
                <select value={form.verification?.provider || 'reoon'}
                  onChange={(e) => updateNested('verification', 'provider', e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
                  <option value="reoon">Reoon</option>
                  <option value="mailboxvalidator">MailboxValidator</option>
                </select>
              </Field>
              <Field label="Verification API Key">
                <TextInput type="password" value={form.verification?.api_key} onChange={(v) => updateNested('verification', 'api_key', v)} placeholder="••••••••" />
              </Field>
              <Toggle checked={form.verify_emails} onChange={(v) => update('verify_emails', v)} label="Enable Email Verification" />
              <Toggle checked={form.verification?.enabled} onChange={(v) => updateNested('verification', 'enabled', v)} label="Verification Enabled" />
            </div>
          </Section>
        </div>
      )}

      {/* AI & Features Tab */}
      {activeTab === 'ai' && (
        <div className="space-y-6">
          <Section title="Feature Toggles" icon={Zap}>
            <div className="space-y-1">
              <Toggle checked={form.ai_personalization_enabled} onChange={(v) => update('ai_personalization_enabled', v)} label="AI Personalization" />
              <Toggle checked={form.job_fit_enabled} onChange={(v) => update('job_fit_enabled', v)} label="Job Fit Evaluation" />
              <Toggle checked={form.outreach_review_enabled} onChange={(v) => update('outreach_review_enabled', v)} label="Outreach Draft Review" />
              <Toggle checked={form.reply_monitor_enabled} onChange={(v) => update('reply_monitor_enabled', v)} label="Reply Monitor" />
              <Toggle checked={form.warmup_enabled} onChange={(v) => update('warmup_enabled', v)} label="Email Warmup" />
              <Toggle checked={form.notifications_enabled} onChange={(v) => update('notifications_enabled', v)} label="Notifications" />
            </div>
          </Section>

          <Section title="Job Fit Settings" icon={Shield}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Min Fit Score">
                <TextInput value={form.job_fit_min_score} onChange={(v) => update('job_fit_min_score', parseInt(v) || 45)} />
              </Field>
              <Field label="Hot Lead Threshold">
                <TextInput value={form.hot_lead_threshold} onChange={(v) => update('hot_lead_threshold', parseInt(v) || 3)} />
              </Field>
            </div>
          </Section>

          <Section title="Warmup Settings" icon={Zap}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Ramp Up Days"><TextInput value={form.warmup?.ramp_up_days} onChange={(v) => updateNested('warmup', 'ramp_up_days', parseInt(v) || 14)} /></Field>
              <Field label="Start Daily"><TextInput value={form.warmup?.start_daily} onChange={(v) => updateNested('warmup', 'start_daily', parseInt(v) || 5)} /></Field>
              <Field label="Max Daily"><TextInput value={form.warmup?.max_daily} onChange={(v) => updateNested('warmup', 'max_daily', parseInt(v) || 100)} /></Field>
              <Field label="Target Daily"><TextInput value={form.warmup?.target_daily} onChange={(v) => updateNested('warmup', 'target_daily', parseInt(v) || 80)} /></Field>
              <Field label="Interval (mins)"><TextInput value={form.warmup?.interval_mins} onChange={(v) => updateNested('warmup', 'interval_mins', parseInt(v) || 15)} /></Field>
            </div>
          </Section>

          <Section title="Smart Selector" icon={Zap}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quality Weight"><TextInput value={form.smart_selector?.quality_weight} onChange={(v) => updateNested('smart_selector', 'quality_weight', parseFloat(v) || 0.8)} /></Field>
              <Field label="Cost Weight"><TextInput value={form.smart_selector?.cost_weight} onChange={(v) => updateNested('smart_selector', 'cost_weight', parseFloat(v) || 0.2)} /></Field>
              <Field label="Lookback Hours"><TextInput value={form.smart_selector?.lookback_hours} onChange={(v) => updateNested('smart_selector', 'lookback_hours', parseInt(v) || 24)} /></Field>
              <Field label="Refresh Interval (s)"><TextInput value={form.smart_selector?.refresh_interval_secs} onChange={(v) => updateNested('smart_selector', 'refresh_interval_secs', parseInt(v) || 3600)} /></Field>
            </div>
          </Section>
        </div>
      )}

      {/* Sending Limits Tab */}
      {activeTab === 'sending' && (
        <div className="space-y-6">
          <Section title="Job Campaign Limits" icon={Shield}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max Emails/Account/Day"><TextInput value={form.sending_limits?.max_emails_per_account_per_day} onChange={(v) => updateNested('sending_limits', 'max_emails_per_account_per_day', parseInt(v) || 150)} /></Field>
              <Field label="Max Emails/Domain/Day"><TextInput value={form.sending_limits?.max_emails_per_domain_per_day} onChange={(v) => updateNested('sending_limits', 'max_emails_per_domain_per_day', parseInt(v) || 25)} /></Field>
              <Field label="Max Emails/Domain/Minute"><TextInput value={form.sending_limits?.max_emails_per_domain_per_minute} onChange={(v) => updateNested('sending_limits', 'max_emails_per_domain_per_minute', parseInt(v) || 2)} /></Field>
            </div>
          </Section>

          <Section title="SaaS Campaign Limits" icon={Shield}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max/Account/Day"><TextInput value={form.saas_sending?.max_per_account_per_day} onChange={(v) => updateNested('saas_sending', 'max_per_account_per_day', parseInt(v) || 200)} /></Field>
              <Field label="Max/Domain/Day"><TextInput value={form.saas_sending?.max_per_domain_per_day} onChange={(v) => updateNested('saas_sending', 'max_per_domain_per_day', parseInt(v) || 40)} /></Field>
            </div>
          </Section>

          <Section title="Timing" icon={Zap}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Send Delay (secs)"><TextInput value={form.send_delay_secs} onChange={(v) => update('send_delay_secs', parseInt(v) || 45)} /></Field>
              <Field label="Concurrency"><TextInput value={form.concurrency} onChange={(v) => update('concurrency', parseInt(v) || 20)} /></Field>
              <Field label="Request Timeout (secs)"><TextInput value={form.request_timeout_secs} onChange={(v) => update('request_timeout_secs', parseInt(v) || 10)} /></Field>
              <Field label="Domain Delay (ms)"><TextInput value={form.domain_delay_ms} onChange={(v) => update('domain_delay_ms', parseInt(v) || 1000)} /></Field>
              <Field label="Google Delay (secs)"><TextInput value={form.google_delay_secs} onChange={(v) => update('google_delay_secs', parseInt(v) || 5)} /></Field>
              <Field label="LinkedIn Delay (secs)"><TextInput value={form.linkedin_delay_secs} onChange={(v) => update('linkedin_delay_secs', parseInt(v) || 3)} /></Field>
              <Field label="Batch Pause (mins)"><TextInput value={form.batch_pause_mins} onChange={(v) => update('batch_pause_mins', parseInt(v) || 30)} /></Field>
              <Field label="SMTP Pool Cooldown (mins)"><TextInput value={form.smtp_pool_cooldown_mins} onChange={(v) => update('smtp_pool_cooldown_mins', parseInt(v) || 60)} /></Field>
              <Field label="Resend Cooldown (secs)"><TextInput value={form.resend_cooldown_secs} onChange={(v) => update('resend_cooldown_secs', parseInt(v) || 900)} /></Field>
              <Field label="Max Retries"><TextInput value={form.max_retries} onChange={(v) => update('max_retries', parseInt(v) || 3)} /></Field>
            </div>
          </Section>

          <Section title="Email Content" icon={Mail}>
            <Field label="Email Subject Template">
              <TextInput value={form.email_subject} onChange={(v) => update('email_subject', v)} />
            </Field>
            <Field label="Webhook URL">
              <TextInput value={form.webhook_url} onChange={(v) => update('webhook_url', v)} placeholder="Optional" />
            </Field>
            <Field label="LimitBreak URL">
              <TextInput value={form.limitbreak_url} onChange={(v) => update('limitbreak_url', v)} />
            </Field>
            <Field label="LimitBreak Key">
              <TextInput type="password" value={form.limitbreak_key} onChange={(v) => update('limitbreak_key', v)} placeholder="••••••••" />
            </Field>
          </Section>
        </div>
      )}

      {/* SaaS Config Tab */}
      {activeTab === 'saas' && (
        <div className="space-y-6">
          <Section title="SaaS Campaign Settings" icon={Server}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="SaaS From Name"><TextInput value={form.saas_from_name} onChange={(v) => update('saas_from_name', v)} /></Field>
              <Field label="SaaS From Email"><TextInput value={form.saas_from_email} onChange={(v) => update('saas_from_email', v)} /></Field>
              <Field label="Follow-up Days"><TextInput value={form.saas_followup_days} onChange={(v) => update('saas_followup_days', parseInt(v) || 3)} /></Field>
              <Field label="Hot Lead Threshold"><TextInput value={form.hot_lead_threshold} onChange={(v) => update('hot_lead_threshold', parseInt(v) || 3)} /></Field>
            </div>
          </Section>

          <Section title="Provider Groups" icon={Server}>
            {Object.entries(form.provider_groups || {}).map(([name, group]) => (
              <div key={name} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 mb-3">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-2">{name}</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-slate-500">Primary:</span> <span className="text-white">{group.primary}</span></div>
                  <div><span className="text-slate-500">Fallbacks:</span> <span className="text-white">{(group.fallbacks || []).join(', ') || 'None'}</span></div>
                  <div><span className="text-slate-500">Retry:</span> <span className={group.retry_on_failure ? 'text-emerald-400' : 'text-slate-500'}>{group.retry_on_failure ? 'Yes' : 'No'}</span></div>
                </div>
              </div>
            ))}
          </Section>

          <Section title="Scraping" icon={Server}>
            <div className="grid grid-cols-2 gap-4">
              <Toggle checked={form.scraping?.enable_dorking} onChange={(v) => updateNested('scraping', 'enable_dorking', v)} label="Enable Dorking" />
              <Field label="Max Concurrency"><TextInput value={form.scraping?.max_concurrency} onChange={(v) => updateNested('scraping', 'max_concurrency', parseInt(v) || 5)} /></Field>
            </div>
          </Section>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notif' && (
        <div className="space-y-6">
          <Section title="Notifications" icon={Bell}>
            <Toggle checked={form.notifications_enabled} onChange={(v) => update('notifications_enabled', v)} label="Enable Notifications" />
            <Field label="Notification Email">
              <TextInput value={form.notification_email} onChange={(v) => update('notification_email', v)} placeholder="email@example.com" />
            </Field>
          </Section>

          <Section title="Alert Thresholds" icon={Shield}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="DLQ Size Alert"><TextInput value={form.alert_thresholds?.dlq_size} onChange={(v) => updateNested('alert_thresholds', 'dlq_size', parseInt(v) || 50)} /></Field>
              <Field label="Consecutive Failures"><TextInput value={form.alert_thresholds?.provider_consecutive_failures} onChange={(v) => updateNested('alert_thresholds', 'provider_consecutive_failures', parseInt(v) || 5)} /></Field>
            </div>
            <Toggle checked={form.alert_thresholds?.retry_exhaustion_alert} onChange={(v) => updateNested('alert_thresholds', 'retry_exhaustion_alert', v)} label="Retry Exhaustion Alert" />
          </Section>
        </div>
      )}
    </div>
  );
}
