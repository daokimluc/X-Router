import { cn } from "@/lib/utils";

export function CodeBlock({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-[#1f2630] bg-code-bg",
        className,
      )}
    >
      {title && (
        <div className="border-b border-[#1f2630] bg-code-header px-4 py-2 font-mono text-[11px] text-code-muted">
          {title}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-code-foreground">
        {children}
      </pre>
    </div>
  );
}
