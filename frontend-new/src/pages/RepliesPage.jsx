import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Inbox } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';

const SENTIMENT_COLORS = {
  positive: '#10b981',
  negative: '#ef4444',
  neutral: '#64748b',
  interested: '#2563eb',
};

export default function RepliesPage() {
  const { data: replies, isLoading } = useQuery({
    queryKey: ['replies'],
    queryFn: api.getReplies,
    refetchInterval: 30000,
  });

  if (isLoading) return <LoadingSpinner text="Loading replies..." />;

  const list = Array.isArray(replies) ? replies : [];

  return (
    <div className="fade-in">
      <PageHeader title="Replies" subtitle={`${list.length} email replies received`} />

      {list.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No Replies Yet"
          description="When prospects respond to your outreach, their replies will appear here with sentiment analysis."
        />
      ) : (
        <div className="space-y-4">
          {list.map((r) => (
            <div
              key={r.id}
              className="bg-[#111827] border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-white">{r.email}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {r.received_at ? new Date(r.received_at).toLocaleString() : '—'}
                  </div>
                </div>
                {r.sentiment && (
                  <span
                    className="text-[10px] font-bold uppercase px-2 py-1 rounded"
                    style={{
                      color: SENTIMENT_COLORS[r.sentiment] || '#64748b',
                      background: `${SENTIMENT_COLORS[r.sentiment] || '#64748b'}18`,
                    }}
                  >
                    {r.sentiment}
                  </span>
                )}
              </div>
              {r.subject && (
                <div className="text-sm text-slate-300 font-medium mb-2">Re: {r.subject}</div>
              )}
              {r.body && (
                <div className="text-sm text-slate-400 bg-slate-800/50 rounded-lg p-3 max-h-[120px] overflow-y-auto">
                  {r.body}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
