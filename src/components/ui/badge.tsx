import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-medium",
  {
    variants: {
      variant: {
        accent: "bg-accent text-accent-foreground",
        outline: "border border-border text-foreground",
        success:
          "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success",
        secondary: "bg-secondary text-secondary-foreground",
      },
      size: {
        sm: "px-2.5 py-0.5 text-[11px]",
        default: "px-3 py-1 text-xs",
      },
    },
    defaultVariants: { variant: "accent", size: "default" },
  },
);

export interface BadgeProps
  extends ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props} />
  );
}
