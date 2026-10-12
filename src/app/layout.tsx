import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Instrument_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { CONSENT_COOKIE_NAME, parseConsentRecord } from "@/lib/consent";

// Newsreader carries display type and the manuscript (its optical sizes run
// from the editor's text cut to the landing's light display cut), Instrument
// Sans does the UI, JetBrains Mono writes the marginalia.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Set once here so every route's file-convention image (opengraph-image.tsx,
// twitter-image.tsx) resolves to an absolute URL instead of localhost; see
// docs/hosting.md for CICIRO_PUBLIC_URL.
export const metadata: Metadata = {
  metadataBase: new URL(process.env["CICIRO_PUBLIC_URL"] || "https://ciciro.app"),
  title: "Ciciro",
  description: "An AI book-writing assistant and manuscript editor.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const initialConsent = parseConsentRecord(jar.get(CONSENT_COOKIE_NAME)?.value ?? null);
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers initialConsent={initialConsent}>{children}</Providers>
      </body>
    </html>
  );
}
