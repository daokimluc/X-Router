import { cn } from "@/lib/utils";

/** Tailwind-styled prose for docs content (no typography plugin needed). */
export function DocProse({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-3xl",
        "[&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight",
        "[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:scroll-mt-20",
        "[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_p]:mt-4 [&_p]:leading-relaxed [&_p]:text-muted-foreground",
        "[&_ul]:mt-4 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:text-muted-foreground [&_li]:marker:text-border",
        "[&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline",
        "[&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        className,
      )}
    >
      {children}
    </div>
  );
}
