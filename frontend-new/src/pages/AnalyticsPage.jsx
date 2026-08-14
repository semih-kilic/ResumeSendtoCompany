import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart as PieIcon, BarChart3, TrendingUp, Activity,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

const COLORS = ['#2563eb', '#60a5fa', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', period],
    queryFn: () => api.getAnalytics(period),
    refetchInterval: 30000,
  });

  if (isLoading) return <LoadingSpinner text="Loading analytics..." />;

  const totals = data?.totals || {};
  const byProvider = data?.byProvider || [];
  const byAction = data?.byAction || [];
  const usageByDay = data?.usageByDay || [];

  const totalEvents = totals.total || 0;
  const providersUsed = byProvider.length;
  const actionsTracked = byAction.length;
  const successRate = totalEvents > 0 ? ((totals.success || 0) / totalEvents * 100).toFixed(1) : 0;
  const totalCost = totals.totalCost || 0;

  const pieData = byProvider.map((p) => ({ name: p.provider, value: p.total || 0, successRate: p.successRate }));
  const barData = byAction.map((a) => ({ action: a.action, success: a.success || 0, failed: a.failed || 0, total: a.total || 0 }));

  return (
    <div className="fade-in">
      <PageHeader title="Analytics" subtitle="Usage metrics, provider breakdown, and action analytics.">
        <div className="flex bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          {['24h', '7d', '30d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 text-xs font-semibold transition-colors ${
                period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard icon={Activity} label="Total Events" value={totalEvents.toLocaleString()} color="#2563eb" />
        <StatCard icon={PieIcon} label="Providers Used" value={providersUsed} color="#10b981" />
        <StatCard icon={BarChart3} label="Actions" value={actionsTracked} color="#f59e0b" />
        <StatCard icon={TrendingUp} label="Success Rate" value={`${successRate}%`} color="#8b5cf6" />
        <StatCard icon={Activity} label="Total Cost" value={`$${totalCost.toFixed(4)}`} color="#ef4444" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Provider Pie Chart */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Provider Usage</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  formatter={(value) => [value, 'Count']}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-slate-600 text-sm">No data</div>
          )}
        </div>

        {/* Actions Bar Chart */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Actions Breakdown</h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="action" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                />
                <Legend />
                <Bar dataKey="success" fill="#10b981" radius={[4, 4, 0, 0]} name="Success" />
                <Bar dataKey="failed" fill="#ef4444" radius={[4, 4, 0, 0]} name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-slate-600 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Usage by Day Line Chart */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 mb-8">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Usage by Day</h3>
        {usageByDay.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={usageByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
              />
              <Legend />
              <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} dot={false} name="Total" />
              <Line type="monotone" dataKey="success" stroke="#10b981" strokeWidth={2} dot={false} name="Success" />
              <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} name="Failed" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[300px] text-slate-600 text-sm">No usage data</div>
        )}
      </div>

      {/* Provider Details Table */}
      {byProvider.length > 0 && (
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Provider Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Provider</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Total</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Success</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Failed</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Success Rate</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Avg Duration</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byProvider.map((p, i) => (
                  <tr key={p.provider || i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="py-3 px-4 flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-slate-200 font-medium">{p.provider}</span>
                    </td>
                    <td className="py-3 px-4 text-right text-white font-medium">{(p.total || 0).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-success font-medium">{(p.success || 0).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-error font-medium">{(p.failed || 0).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-semibold ${
                        p.successRate >= 90 ? 'text-success' :
                        p.successRate >= 50 ? 'text-warning' : 'text-error'
                      }`}>
                        {p.successRate ?? 0}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400 text-xs">
                      {p.avgDurationMs ? `${(p.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400 text-xs">
                      {p.totalCost > 0 ? `$${p.totalCost.toFixed(4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
