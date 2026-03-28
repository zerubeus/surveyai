"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LOCALES = [
  { code: "en", label: "EN", flag: "🇬🇧" },
  { code: "fr", label: "FR", flag: "🇫🇷" },
];

/** Reads current locale from cookie or URL prefix, switches app language */
export function LanguageSwitcher() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Detect current locale from first path segment
  const currentLocale = LOCALES.find((l) => pathname.startsWith(`/${l.code}/`) || pathname === `/${l.code}`)?.code ?? "en";
  const current = LOCALES.find((l) => l.code === currentLocale) ?? LOCALES[0];

  function switchLocale(code: string) {
    setOpen(false);
    if (code === currentLocale) return;

    // Build new path: replace /fr/ prefix or add it
    let newPath = pathname;
    if (currentLocale !== "en") {
      // Remove existing locale prefix
      newPath = pathname.replace(new RegExp(`^/${currentLocale}`), "") || "/";
    }
    if (code !== "en") {
      newPath = `/${code}${newPath}`;
    }

    // Store preference
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000`;
    router.push(newPath as never);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        aria-label="Switch language"
      >
        <span>{current.flag}</span>
        <span className="font-medium">{current.label}</span>
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-50 min-w-[80px] rounded-md border bg-white py-1 shadow-md">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => switchLocale(l.code)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 ${
                l.code === currentLocale ? "font-semibold text-blue-600" : "text-gray-700"
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
