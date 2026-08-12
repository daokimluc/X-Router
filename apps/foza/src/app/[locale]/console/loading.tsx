// Streamed fallback for every console route. Because each console page is
// `force-dynamic` and awaits a live X-Router call, Next prefetches this
// skeleton and shows it instantly on navigation instead of blocking on the
// server. Mirrors the shared page shape: header → KPI cards → content block.
export default function ConsoleLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-fade-in" aria-busy="true">
      {/* Page header */}
      <div className="mb-6 space-y-2">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-4 w-72" />
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-4 w-4 rounded-full" />
            </div>
            <div className="skeleton mt-3 h-7 w-24" />
          </div>
        ))}
      </div>

      {/* Content block (table / list placeholder) */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-8 w-28 rounded-lg" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="skeleton h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-3 w-1/4" />
              </div>
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
