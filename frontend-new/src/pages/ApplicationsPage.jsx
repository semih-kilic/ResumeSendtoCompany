import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';

const STATUS_COLORS = {
  applied: { color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
  replied: { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  interview: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  rejected: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  offer: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  withdrawn: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
};

const STATUSES = ['applied', 'replied', 'interview', 'rejected', 'offer', 'withdrawn'];

export default function ApplicationsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['applications', page, status],
    queryFn: () => api.getApplications({ page, limit: 30, ...(status && { status }) }),
    refetchInterval: 60000,
  });

  const updateMut = useMutation({
    mutationFn: ({ email, status }) => api.updateApplicationStatus(email, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });

  if (isLoading) return <LoadingSpinner text="Loading applications..." />;

  const records = data?.records || [];
  const totalPages = data?.totalPages || 0;

  return (
    <div className="fade-in">
      <PageHeader title="Applications" subtitle={`Tracking ${data?.total || 0} job applications`}>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="bg-[#111827] border border-slate-800 rounded-lg px-4 py-2 text-sm text-slate-300 focus:border-accent focus:outline-none"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </PageHeader>

      {records.length === 0 ? (
        <EmptyState icon={Briefcase} title="No Applications" description="No job applications found matching your filter." />
      ) : (
        <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Company</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Role</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Status</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Fit Score</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Date</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const sc = STATUS_COLORS[r.status] || STATUS_COLORS.applied;
                  return (
                    <tr key={r.id || r.email} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-white font-medium">{r.email}</td>
                      <td className="py-3 px-4 text-slate-300">{r.company_name || '—'}</td>
                      <td className="py-3 px-4 text-slate-400 text-xs max-w-[200px] truncate">{r.role || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className="text-[10px] font-bold uppercase px-2 py-1 rounded"
                          style={{ color: sc.color, background: sc.bg }}
                        >
                          {r.status || 'applied'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {r.fit_score != null ? (
                          <span
                            className="text-xs font-bold"
                            style={{
                              color: r.fit_score >= 75 ? '#10b981' : r.fit_score >= 60 ? '#3b82f6' : r.fit_score >= 45 ? '#f59e0b' : '#ef4444',
                            }}
                          >
                            {r.fit_score}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-xs">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <select
                          value={r.status || 'applied'}
                          onChange={(e) => updateMut.mutate({ email: r.email, status: e.target.value })}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-accent focus:outline-none"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
              <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
