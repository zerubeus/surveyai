import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "fr"],
  defaultLocale: "en",
  // Use path prefix for non-default locales: /fr/... 
  // Default locale (en) has no prefix: /dashboard
  localePrefix: "as-needed",
});
