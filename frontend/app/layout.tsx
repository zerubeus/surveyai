import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chisquare",
  description:
    "AI-powered survey data analysis platform for NGOs and research firms",
  openGraph: {
    title: "Chisquare",
    description: "From survey data to publication-ready reports in hours, not weeks.",
    type: "website",
  },
};

// Plausible analytics domain — set NEXT_PUBLIC_PLAUSIBLE_DOMAIN in .env.local
// e.g. NEXT_PUBLIC_PLAUSIBLE_DOMAIN=chisquare.app
// Set NEXT_PUBLIC_PLAUSIBLE_HOST for self-hosted: https://plausible.yourserver.com
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "";
const PLAUSIBLE_HOST = process.env.NEXT_PUBLIC_PLAUSIBLE_HOST ?? "https://plausible.io";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {PLAUSIBLE_DOMAIN && (
          <script
            defer
            data-domain={PLAUSIBLE_DOMAIN}
            src={`${PLAUSIBLE_HOST}/js/script.js`}
          />
        )}
      </head>
      <body className={inter.className} suppressHydrationWarning>{children}</body>
    </html>
  );
}
