import type { Metadata } from "next";
import { Courier_Prime, Instrument_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

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

// A screenplay is always 12pt Courier Prime, whatever the editor font settings
// say: the page count depends on every glyph being the same width as Courier's
// (SIL OFL 1.1, self-hosted by next/font).
const courierPrime = Courier_Prime({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-script",
  display: "swap",
  // Fetched when a script is on the page, not preloaded on every other page.
  preload: false,
});

export const metadata: Metadata = {
  title: "Ciciro",
  description: "An AI book-writing assistant and manuscript editor.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} ${courierPrime.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
