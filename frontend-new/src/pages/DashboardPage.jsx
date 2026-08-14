import { useQuery } from '@tanstack/react-query';
import {
  Building2, Mail, CheckCircle, Send, Briefcase, Target,
  TrendingUp, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../api/client';
import StatCard from '../components/StatCard';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

const CHART_COLORS = ['#2563eb', '#60a5fa', '#10b981', '#f59e0b', '#8b5cf6'];

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 5000,
  });

  const { data: saasStatus } = useQuery({
    queryKey: ['saasStatus'],
    queryFn: api.getSaaSStatus,
    refetchInterval: 8000,
  });

  const { data: scanStatus } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: api.getScanStatus,
    refetchInterval: 5000,
  });

  if (isLoading) return <LoadingSpinner text="Initializing dashboard..." />;

  const emailDays = stats?.emailsByDay || [];
  const emailTypes = stats?.emailsByType || [];

  return (
    <div className="fade-in">
      <PageHeader
        title="Executive Overview"
        subtitle="Mission status, discovery metrics, and outreach performance analytics."
      >
        <div className="flex items-center gap-2 bg-[#111827] border border-slate-800 rounded-lg px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_#10b981] animate-pulse-dot" />
          <span className="text-xs font-semibold text-slate-300">SYSTEM ONLINE</span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard icon={Building2} label="Companies" value={stats?.totalCompanies} color="#2563eb" />
        <StatCard icon={Mail} label="Discovered" value={stats?.emailsDiscovered} color="#60a5fa" />
        <StatCard icon={CheckCircle} label="Verified" value={stats?.emailsVerified} color="#10b981" />
        <StatCard icon={Send} label="Sent" value={stats?.emailsSent} color="#f59e0b" />
        <StatCard icon={Briefcase} label="Applications" value={stats?.applications} color="#8b5cf6" />
        <StatCard icon={Target} label="Fit Evaluated" value={stats?.fitEvaluated} color="#10b981" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Emails by Day</h3>
          {emailDays.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={emailDays}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                />
                <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-slate-600 text-sm">
              No email data yet
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Email Types</h3>
          {emailTypes.length > 0 ? (
            <div className="space-y-3">
              {emailTypes.map((et, i) => (
                <div key={et.type || i} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-sm text-slate-300 flex-1">{et.type || 'Unknown'}</span>
                  <span className="text-sm font-semibold text-white">{et.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-600 text-sm text-center py-8">No data</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">SaaS Campaign</h3>
          {saasStatus ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${saasStatus.status === 'running' ? 'bg-success animate-pulse-dot' : 'bg-slate-600'}`} />
                <span className="text-sm font-medium text-slate-300 capitalize">{saasStatus.status || 'idle'}</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-slate-500">Sent</div>
                  <div className="text-lg font-bold text-white">{saasStatus.sent || 0}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Total</div>
                  <div className="text-lg font-bold text-white">{saasStatus.totalRecipients || 0}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Failed</div>
                  <div className="text-lg font-bold text-error">{saasStatus.failed || 0}</div>
                </div>
              </div>
              {saasStatus.activeProvider && (
                <div className="text-xs text-slate-500">
                  Provider: <span className="text-slate-300">{saasStatus.activeProvider}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-slate-600 text-sm text-center py-8">No SaaS campaign data</div>
          )}
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Scan Status</h3>
          {scanStatus ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${scanStatus.status === 'running' ? 'bg-accent animate-pulse-dot' : 'bg-slate-600'}`} />
                <span className="text-sm font-medium text-slate-300 capitalize">{scanStatus.status || 'idle'}</span>
              </div>
              {scanStatus.status === 'running' && (
                <>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className="bg-accent h-2 rounded-full transition-all duration-500"
                      style={{
                        width: scanStatus.totalCompanies > 0
                          ? `${(scanStatus.processedCompanies / scanStatus.totalCompanies) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{scanStatus.processedCompanies}/{scanStatus.totalCompanies} companies</span>
                    <span>{scanStatus.emailsFound} emails found</span>
                  </div>
                </>
              )}
              {stats?.errors > 0 && (
                <div className="flex items-center gap-2 text-xs text-error">
                  <AlertTriangle size={14} />
                  <span>{stats.errors} errors</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-slate-600 text-sm text-center py-8">Scanner idle</div>
          )}
        </div>
      </div>
    </div>
  );
}
