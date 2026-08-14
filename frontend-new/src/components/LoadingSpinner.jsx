export default function LoadingSpinner({ text = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-8 h-8 border-2 border-slate-700 border-t-accent rounded-full animate-spin" />
      <span className="text-xs text-slate-500 tracking-widest uppercase">{text}</span>
    </div>
  );
}
