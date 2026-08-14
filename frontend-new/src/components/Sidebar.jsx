import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, Mail, Briefcase, Radar,
  Send, Cloud, MessageSquare, Settings, FileText,
  Activity, Bell, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useSidebar } from './Layout';

const links = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/emails', icon: Mail, label: 'Emails' },
  { to: '/applications', icon: Briefcase, label: 'Applications' },
  { to: '/scan', icon: Radar, label: 'Scan / Discovery' },
  { to: '/campaign', icon: Send, label: 'Campaign' },
  { to: '/saas', icon: Cloud, label: 'SaaS Campaign' },
  { to: '/replies', icon: MessageSquare, label: 'Replies' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/template', icon: FileText, label: 'Templates' },
  { to: '/providers', icon: Activity, label: 'Provider Health' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
];

export default function Sidebar() {
  const { collapsed, setCollapsed } = useSidebar();
  const { data: notifData } = useQuery({
    queryKey: ['unreadCount'],
    queryFn: api.getUnreadCount,
    refetchInterval: 15000,
  });

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-bg-card border-r border-slate-800 flex flex-col z-50 transition-all duration-300 ${
        collapsed ? 'w-[68px]' : 'w-[240px]'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-5 border-b border-slate-800">
        {!collapsed && (
          <span className="text-sm font-bold tracking-wider text-white uppercase">
            Canada Outreach
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-accent/15 text-accent font-semibold'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              } ${collapsed ? 'justify-center px-2' : ''}`
            }
          >
            <link.icon size={18} />
            {!collapsed && <span>{link.label}</span>}
            {link.to === '/notifications' && notifData?.count > 0 && (
              <span className="ml-auto bg-error text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {notifData.count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-600">
          v1.0 — Canada Outreach
        </div>
      )}
    </aside>
  );
}
