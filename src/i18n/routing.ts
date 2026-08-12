import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["vi", "en"],
  defaultLocale: "vi",
  // Default locale (vi) is also prefixed: /vi, /en — matches foza.ai
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
