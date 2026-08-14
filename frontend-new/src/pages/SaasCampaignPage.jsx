import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cloud, Play, Square, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { useSSE } from '../hooks/useSSE';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';

export default function SaasCampaignPage() {
  const qc = useQueryClient();
  const { events, connected } = useSSE('/api/saas/stream');

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['saasStatus'],
    queryFn: api.getSaaSStatus,
    refetchInterval: 3000,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['saasHistory'],
    queryFn: api.getSaaSHistory,
    refetchInterval: 15000,
  });

  const startMut = useMutation({
    mutationFn: () => api.startSaaS({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saasStatus'] }),
  });

  const stopMut = useMutation({
    mutationFn: api.stopSaaS,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saasStatus'] }),
  });

  if (statusLoading) return <LoadingSpinner text="Loading SaaS campaign..." />;

  const isRunning = status?.status === 'running';
  const progress = status?.totalRecipients > 0
    ? Math.round((status.sent / status.totalRecipients) * 100)
    : 0;

  return (
    <div className="fade-in">
      <PageHeader title="SaaS Campaign" subtitle="Automated SaaS outreach campaign.">
        <div className="flex items-center gap-3">
          {connected && (
            <div className="flex items-center gap-2 text-xs text-success">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse-dot" />
              Live
            </div>
          )}
          {!isRunning ? (
            <button
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending}
              className="flex items-center gap-2 bg-success text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-success/80 transition-colors disabled:opacity-50"
            >
              <Play size={16} />
              Start
            </button>
          ) : (
            <button
              onClick={() => stopMut.mutate()}
              disabled={stopMut.isPending}
              className="flex items-center gap-2 bg-error text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-error/80 transition-colors disabled:opacity-50"
            >
              <Square size={16} />
              Stop
            </button>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-center">
          <div className="text-xs text-slate-500 mb-1">Status</div>
          <div className="flex items-center justify-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-success animate-pulse-dot' : 'bg-slate-600'}`} />
            <span className="text-sm font-medium text-slate-300 capitalize">{status?.status || 'idle'}</span>
          </div>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-center">
          <div className="text-xs text-slate-500 mb-1">Sent</div>
          <div className="text-xl font-bold text-success">{status?.sent || 0}</div>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-center">
          <div className="text-xs text-slate-500 mb-1">Total</div>
          <div className="text-xl font-bold text-white">{status?.totalRecipients || 0}</div>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-center">
          <div className="text-xs text-slate-500 mb-1">Failed</div>
          <div className="text-xl font-bold text-error">{status?.failed || 0}</div>
        </div>
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 text-center">
          <div className="text-xs text-slate-500 mb-1">Provider</div>
          <div className="text-sm font-medium text-accent">{status?.activeProvider || '—'}</div>
        </div>
      </div>

      {isRunning && (
        <div className="mb-8 bg-[#111827] border border-slate-800 rounded-xl p-4">
          <div className="w-full bg-slate-800 rounded-full h-2.5">
            <div
              className="bg-success h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-slate-500 text-center mt-2">{progress}% complete</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">History</h3>
          {historyLoading ? (
            <LoadingSpinner text="Loading history..." />
          ) : !history || history.length === 0 ? (
            <EmptyState icon={Cloud} title="No History" description="No SaaS emails sent yet." />
          ) : (
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#111827]">
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Company</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Email</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Sent</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 50).map((h) => (
                    <tr key={h.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-3 text-slate-300 max-w-[120px] truncate">{h.company_name || '—'}</td>
                      <td className="py-2 px-3 text-white text-xs">{h.email}</td>
                      <td className="py-2 px-3 text-slate-400 text-xs">
                        {h.sent_at ? new Date(h.sent_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          h.status === 'sent' ? 'text-success bg-success/10' :
                          h.status === 'failed' ? 'text-error bg-error/10' :
                          'text-slate-400 bg-slate-800'
                        }`}>
                          {h.status || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Live Log</h3>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw size={12} className={connected ? 'animate-spin' : ''} />
              {connected ? 'Connected' : 'Disconnected'}
            </div>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 h-[280px] overflow-y-auto font-mono text-xs">
            {events.length === 0 ? (
              <div className="text-slate-600">Waiting for SaaS events...</div>
            ) : (
              events.map((ev, i) => (
                <div key={i} className="py-0.5 flex gap-2">
                  <span className="text-slate-600 shrink-0">{new Date(ev.ts).toLocaleTimeString()}</span>
                  <span className={ev.data?.type === 'error' ? 'text-error' : 'text-slate-300'}>
                    {ev.data?.message || ev.data?.log || JSON.stringify(ev.data)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
