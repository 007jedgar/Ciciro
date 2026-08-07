import type { Metadata } from "next";
import { Literata, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const literata = Literata({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ciciro",
  description: "An AI book-writing assistant and manuscript editor.",
};

const themeBoot = `
(function () {
  try {
    var key = "ciciro-theme";
    var stored = localStorage.getItem(key);
    var themes = ["parchment", "sage", "ember", "walnut", "inkwell", "candle"];
    var id = themes.indexOf(stored) !== -1 ? stored : null;
    if (!id) {
      id = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "ember"
        : "parchment";
    }
    document.documentElement.setAttribute("data-theme", id);
    var dark = id === "ember" || id === "walnut" || id === "inkwell" || id === "candle";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "parchment");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${literata.variable} ${sourceSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
