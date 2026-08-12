import type { ReactNode } from "react";

// Root layout is intentionally minimal — the real <html>/<body> lives in
// the [locale] layout so next-intl can set the correct lang attribute.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
