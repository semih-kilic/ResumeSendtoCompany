import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle, XCircle, Clock, Layers } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';

const STATUS_ICONS = {
  healthy: { icon: CheckCircle, color: '#10b981' },
  degraded: { icon: AlertTriangle, color: '#f59e0b' },
  down: { icon: XCircle, color: '#ef4444' },
  idle: { icon: Clock, color: '#64748b' },
};

export default function ProviderHealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['providerStatus'],
    queryFn: api.getProviderStatus,
    refetchInterval: 15000,
  });

  const { data: dlqData } = useQuery({
    queryKey: ['dlq'],
    queryFn: () => api.getDLQ({ page: 1, limit: 50 }),
    refetchInterval: 30000,
  });

  if (isLoading) return <LoadingSpinner text="Loading provider health..." />;

  const providersObj = data?.providers || {};
  const dlqStats = data?.dlq || {};
  const dlq = dlqData?.items || [];

  const providerList = Object.entries(providersObj).map(([name, info]) => ({
    name,
    ...info,
    status: info.enabled ? (info.failureCount > 0 ? 'degraded' : 'healthy') : 'down',
  }));

  const DLQ_FIELDS = [
    { key: 'queue_name', label: 'Queue' },
    { key: 'item_data', label: 'Data' },
    { key: 'error_message', label: 'Error' },
    { key: 'retry_count', label: 'Retries' },
    { key: 'status', label: 'Status' },
    { key: 'created_at', label: 'Created' },
  ];

  return (
    <div className="fade-in">
      <PageHeader title="Provider Health" subtitle="Monitor AI/scraping provider status and dead letter queue." />

      {/* DLQ Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Retried', value: dlqStats.totalRetried || 0, color: '#60a5fa' },
          { label: 'Succeeded', value: dlqStats.totalSucceeded || 0, color: '#10b981' },
          { label: 'Failed', value: dlqStats.totalFailed || 0, color: '#f59e0b' },
          { label: 'Exhausted', value: dlqStats.totalExhausted || 0, color: '#ef4444' },
        ].map((s) => (
          <div key={s.label} className="bg-[#111827] border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {providerList.length === 0 ? (
          <div className="col-span-full">
            <EmptyState icon={Activity} title="No Providers" description="No providers configured." />
          </div>
        ) : (
          providerList.map((p) => {
            const st = STATUS_ICONS[p.status] || STATUS_ICONS.idle;
            const Icon = st.icon;
            return (
              <div
                key={p.name}
                className="bg-[#111827] border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-white capitalize">{p.name}</h4>
                  <div className="flex items-center gap-2">
                    <Icon size={16} style={{ color: st.color }} />
                    <span className="text-xs font-medium capitalize" style={{ color: st.color }}>
                      {p.status}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Failures</span>
                    <span className={`font-medium ${p.failureCount > 0 ? 'text-error' : 'text-success'}`}>
                      {p.failureCount || 0}
                    </span>
                  </div>
                  {p.reason && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Reason</span>
                      <span className="text-warning font-medium">{p.reason}</span>
                    </div>
                  )}
                  {p.lastFailedAt && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Last Failed</span>
                      <span className="text-slate-400 text-[10px]">
                        {new Date(p.lastFailedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {p.cooldownUntil && Date.now() < p.cooldownUntil && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Cooldown</span>
                      <span className="text-warning text-[10px]">
                        {Math.round((p.cooldownUntil - Date.now()) / 60000)}m left
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* DLQ Table */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Layers size={16} className="text-error" />
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Dead Letter Queue ({dlqData?.total || 0})
          </h3>
        </div>
        {dlq.length === 0 ? (
          <div className="text-center py-8 text-slate-600 text-sm">DLQ is empty — all good!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {DLQ_FIELDS.map((f) => (
                    <th key={f.key} className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dlq.map((item) => (
                  <tr key={item.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-slate-300 text-xs">{item.queue_name || '—'}</td>
                    <td className="py-3 px-4 text-white text-xs max-w-[250px] truncate">{item.item_data || '—'}</td>
                    <td className="py-3 px-4 text-error text-xs max-w-[300px] truncate">{item.error_message || '—'}</td>
                    <td className="py-3 px-4 text-slate-400 text-xs">{item.retry_count ?? '—'}</td>
                    <td className="py-3 px-4 text-xs">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        item.status === 'failed' ? 'bg-red-900/40 text-red-400' :
                        item.status === 'pending' ? 'bg-yellow-900/40 text-yellow-400' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {item.status || '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
