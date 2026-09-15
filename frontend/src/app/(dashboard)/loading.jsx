export default function DashboardLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" aria-hidden="true"></div>
      <span className="ml-3 text-xs text-on-surface-variant font-semibold">Loading…</span>
    </div>
  );
}
