import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Download, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';

const TYPE_COLORS = {
  generic: '#64748b',
  role: '#2563eb',
  department: '#10b981',
  personal: '#f59e0b',
  support: '#8b5cf6',
};

export default function EmailsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['emails', page, search, type],
    queryFn: () => api.getEmails({ page, limit: 25, ...(search && { search }), ...(type && { type }) }),
    refetchInterval: 15000,
  });

  const toggleMut = useMutation({
    mutationFn: api.toggleExclude,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });

  const handleExport = async () => {
    const blob = await api.exportCSV({ search, type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emails.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  if (isLoading) return <LoadingSpinner text="Loading emails..." />;

  const records = data?.records || [];
  const totalPages = data?.totalPages || 0;

  return (
    <div className="fade-in">
      <PageHeader title="Emails" subtitle={`Total: ${data?.total || 0} emails discovered`}>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 bg-success/15 text-success px-4 py-2 rounded-lg text-sm font-semibold hover:bg-success/25 transition-colors"
        >
          <Download size={16} />
          Export CSV
        </button>
      </PageHeader>

      <div className="flex items-center gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search emails..."
              className="w-full bg-[#111827] border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent/80 transition-colors"
          >
            Search
          </button>
        </form>

        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setPage(1); }}
          className="bg-[#111827] border border-slate-800 rounded-lg px-4 py-2 text-sm text-slate-300 focus:border-accent focus:outline-none"
        >
          <option value="">All Types</option>
          <option value="generic">Generic</option>
          <option value="role">Role</option>
          <option value="department">Department</option>
          <option value="personal">Personal</option>
          <option value="support">Support</option>
        </select>
      </div>

      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Company</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Email</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Source</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Found</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Verified</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Sent</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Excluded</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-600">No emails found</td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id || r.email} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 text-slate-200 max-w-[180px] truncate">{r.company_name || '—'}</td>
                    <td className="py-3 px-4 text-white font-medium">{r.email}</td>
                    <td className="py-3 px-4">
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-1 rounded"
                        style={{
                          color: TYPE_COLORS[r.email_type] || '#64748b',
                          background: `${TYPE_COLORS[r.email_type] || '#64748b'}18`,
                        }}
                      >
                        {r.email_type || '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs">{r.source || '—'}</td>
                    <td className="py-3 px-4 text-slate-400 text-xs">{r.found_date ? new Date(r.found_date).toLocaleDateString() : '—'}</td>
                    <td className="py-3 px-4 text-center">
                      {r.verified ? (
                        <span className="text-success text-xs font-bold">✓</span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {r.sent ? (
                        <span className="text-accent text-xs font-bold">✓</span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {r.excluded ? (
                        <span className="text-error text-xs font-bold">✓</span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => toggleMut.mutate(r.id)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                        title={r.excluded ? 'Include' : 'Exclude'}
                      >
                        {r.excluded ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
            <span className="text-xs text-slate-500">
              Page {page} of {totalPages}
            </span>
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
    </div>
  );
}
