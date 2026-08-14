import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';

const TYPE_COLORS = {
  info: '#2563eb',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
};

export default function NotificationsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: api.getNotifications,
    refetchInterval: 15000,
  });

  const { data: unread } = useQuery({
    queryKey: ['unreadCount'],
    queryFn: api.getUnreadCount,
    refetchInterval: 10000,
  });

  const markAllMut = useMutation({
    mutationFn: api.markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unreadCount'] });
    },
  });

  if (isLoading) return <LoadingSpinner text="Loading notifications..." />;

  const records = data?.records || [];

  return (
    <div className="fade-in">
      <PageHeader title="Notifications" subtitle={`${unread?.count || 0} unread`}>
        {records.length > 0 && (
          <button
            onClick={() => markAllMut.mutate()}
            disabled={markAllMut.isPending}
            className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <CheckCheck size={16} />
            Mark All Read
          </button>
        )}
      </PageHeader>

      {records.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No Notifications"
          description="You're all caught up! Notifications will appear here when events occur."
        />
      ) : (
        <div className="space-y-3">
          {records.map((n) => {
            const color = TYPE_COLORS[n.type] || TYPE_COLORS.info;
            return (
              <div
                key={n.id}
                className={`bg-[#111827] border rounded-xl p-4 flex items-start gap-4 transition-colors ${
                  n.read ? 'border-slate-800/50 opacity-60' : 'border-slate-800'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full mt-2 shrink-0"
                  style={{ background: color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium">{n.title || n.message || 'Notification'}</div>
                  {n.body && <div className="text-xs text-slate-400 mt-1">{n.body}</div>}
                  <div className="text-[11px] text-slate-600 mt-2">
                    {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
