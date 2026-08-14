export default function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      {Icon && <Icon size={48} className="text-slate-700" />}
      <h3 className="text-lg font-semibold text-slate-300">{title}</h3>
      {description && <p className="text-sm text-slate-500 max-w-md">{description}</p>}
    </div>
  );
}
