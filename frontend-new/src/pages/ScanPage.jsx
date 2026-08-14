import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Radar, Play, Square, RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { useSSE } from '../hooks/useSSE';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

export default function ScanPage() {
  const [industry, setIndustry] = useState('');
  const qc = useQueryClient();
  const { events, connected } = useSSE('/api/scan/stream');

  const { data: status, isLoading } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: api.getScanStatus,
    refetchInterval: 3000,
  });

  const startMut = useMutation({
    mutationFn: () => api.startScan(industry ? { industry } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanStatus'] }),
  });

  const stopMut = useMutation({
    mutationFn: api.stopScan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanStatus'] }),
  });

  if (isLoading) return <LoadingSpinner text="Loading scan status..." />;

  const isRunning = status?.status === 'running';
  const progress = status?.totalCompanies > 0
    ? Math.round((status.processedCompanies / status.totalCompanies) * 100)
    : 0;

  return (
    <div className="fade-in">
      <PageHeader title="Scan / Discovery" subtitle="Discover companies and extract email addresses.">
        <div className="flex items-center gap-2">
          {connected && (
            <div className="flex items-center gap-2 text-xs text-success">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse-dot" />
              Live
            </div>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Controls</h3>
          <div className="flex items-center gap-3 mb-4">
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Industry filter (optional)"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-accent focus:outline-none"
            />
            {!isRunning ? (
              <button
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
                className="flex items-center gap-2 bg-success text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-success/80 transition-colors disabled:opacity-50"
              >
                <Play size={16} />
                Start Scan
              </button>
            ) : (
              <button
                onClick={() => stopMut.mutate()}
                disabled={stopMut.isPending}
                className="flex items-center gap-2 bg-error text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-error/80 transition-colors disabled:opacity-50"
              >
                <Square size={16} />
                Stop
              </button>
            )}
          </div>

          {isRunning && (
            <div className="space-y-3">
              <div className="w-full bg-slate-800 rounded-full h-3">
                <div
                  className="bg-accent h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>{status.processedCompanies}/{status.totalCompanies} companies</span>
                <span>{progress}%</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500">Emails Found</div>
                  <div className="text-lg font-bold text-success">{status.emailsFound || 0}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500">Rejected</div>
                  <div className="text-lg font-bold text-warning">{status.emailsRejected || 0}</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500">Errors</div>
                  <div className="text-lg font-bold text-error">{status.errors || 0}</div>
                </div>
              </div>
              {status.estimatedRemainingSecs > 0 && (
                <div className="text-xs text-slate-500 text-center">
                  ETA: ~{Math.round(status.estimatedRemainingSecs / 60)}m {status.estimatedRemainingSecs % 60}s
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Status</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-success animate-pulse-dot' : 'bg-slate-600'}`} />
              <span className="text-sm text-slate-300 capitalize">{status?.status || 'idle'}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Companies</span>
                <span className="text-white font-medium">{status?.totalCompanies || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Processed</span>
                <span className="text-white font-medium">{status?.processedCompanies || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Emails Found</span>
                <span className="text-success font-medium">{status?.emailsFound || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Errors</span>
                <span className="text-error font-medium">{status?.errors || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Live Log</h3>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw size={12} className={connected ? 'animate-spin' : ''} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <div className="bg-slate-900 rounded-lg p-4 h-[300px] overflow-y-auto font-mono text-xs">
          {events.length === 0 ? (
            <div className="text-slate-600">Waiting for scan events...</div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="py-0.5 flex gap-2">
                <span className="text-slate-600 shrink-0">{new Date(ev.ts).toLocaleTimeString()}</span>
                <span className={
                  ev.type === 'log'
                    ? 'text-slate-300'
                    : ev.data?.type === 'error'
                    ? 'text-error'
                    : 'text-accent'
                }>
                  {ev.data?.message || ev.data?.log || JSON.stringify(ev.data)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
