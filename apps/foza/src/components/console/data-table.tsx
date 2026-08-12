import { Inbox } from "lucide-react";

/** A table card with header, empty-state body, and a pagination footer — matches the console template. */
export function DataTable({
  columns,
  emptyTitle,
  emptyHint,
  pageSize = "10 / page",
}: {
  columns: string[];
  emptyTitle: string;
  emptyHint?: string;
  pageSize?: string;
}) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-border">
      <div className="w-full overflow-auto bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((c, i) => (
                <th
                  key={c + i}
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-4 py-16 text-center">
                <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/50 text-muted-foreground">
                  <Inbox className="h-5 w-5" />
                </span>
                <p className="text-sm text-muted-foreground">{emptyTitle}</p>
                {emptyHint && (
                  <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span>{pageSize}</span>
        <span>1 / 1</span>
      </div>
    </div>
  );
}
