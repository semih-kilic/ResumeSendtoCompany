export default function StatCard({ icon: Icon, label, value, color = '#2563eb', sub }) {
  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-2 hover:border-slate-700 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className="p-2 rounded-lg" style={{ background: `${color}18` }}>
            <Icon size={16} style={{ color }} />
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white" style={{ color }}>
        {value ?? '—'}
      </div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
