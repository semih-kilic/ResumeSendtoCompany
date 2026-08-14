import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Square, Upload, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { useSSE } from '../hooks/useSSE';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

export default function CampaignPage() {
  const [dryRun, setDryRun] = useState(false);
  const fileRef = useRef(null);
  const qc = useQueryClient();
  const { events, connected } = useSSE('/api/campaign/stream');

  const { data: status, isLoading } = useQuery({
    queryKey: ['campaignStatus'],
    queryFn: api.getCampaignStatus,
    refetchInterval: 3000,
  });

  const startMut = useMutation({
    mutationFn: () => api.startCampaign({ dryRun }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaignStatus'] }),
  });

  const stopMut = useMutation({
    mutationFn: api.stopCampaign,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaignStatus'] }),
  });

  const uploadMut = useMutation({
    mutationFn: (file) => api.uploadResume(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaignStatus'] }),
  });

  if (isLoading) return <LoadingSpinner text="Loading campaign..." />;

  const isRunning = status?.status === 'running';
  const progress = status?.totalRecipients > 0
    ? Math.round((status.sent / status.totalRecipients) * 100)
    : 0;

  return (
    <div className="fade-in">
      <PageHeader title="Campaign" subtitle="Email campaign management and monitoring.">
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
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-accent focus:ring-accent"
              />
              Dry Run
            </label>

            <div className="flex-1" />

            {!isRunning ? (
              <button
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
                className="flex items-center gap-2 bg-success text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-success/80 transition-colors disabled:opacity-50"
              >
                <Send size={16} />
                Start Campaign
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

          <div className="border-t border-slate-800 pt-4 mt-4">
            <div className="text-xs text-slate-500 mb-2">Upload Resume (optional)</div>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => {
                  if (e.target.files?.[0]) uploadMut.mutate(e.target.files[0]);
                }}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition-colors"
              >
                <Upload size={14} />
                Choose File
              </button>
              {uploadMut.isPending && <span className="text-xs text-slate-500">Uploading...</span>}
              {uploadMut.isSuccess && <span className="text-xs text-success">Uploaded!</span>}
            </div>
          </div>

          {isRunning && (
            <div className="mt-6 space-y-3">
              <div className="w-full bg-slate-800 rounded-full h-3">
                <div
                  className="bg-success h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>{status.sent}/{status.totalRecipients} sent</span>
                <span>{progress}%</span>
              </div>
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
                <span className="text-slate-500">Sent</span>
                <span className="text-success font-medium">{status?.sent || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total</span>
                <span className="text-white font-medium">{status?.totalRecipients || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Failed</span>
                <span className="text-error font-medium">{status?.failed || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Dry Run</span>
                <span className="text-white font-medium">{status?.dryRun ? 'Yes' : 'No'}</span>
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
            <div className="text-slate-600">Waiting for campaign events...</div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="py-0.5 flex gap-2">
                <span className="text-slate-600 shrink-0">{new Date(ev.ts).toLocaleTimeString()}</span>
                <span className={
                  ev.data?.type === 'error' ? 'text-error' : 'text-slate-300'
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
