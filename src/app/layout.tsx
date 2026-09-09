import type { Metadata } from "next";
import { Literata, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";

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
    var themes = ["parchment", "sage", "ember", "walnut", "inkwell", "candle"];
    var id = null;
    var font = null;
    var size = null;
    try {
      var blob = JSON.parse(localStorage.getItem("ciciro-settings") || "null");
      if (blob && themes.indexOf(blob.theme) !== -1) id = blob.theme;
      if (blob && (blob.editorFont === "serif" || blob.editorFont === "sans")) font = blob.editorFont;
      if (blob && typeof blob.editorFontSize === "number") size = blob.editorFontSize;
    } catch (e) {}
    if (!id) {
      var stored = localStorage.getItem("ciciro-theme");
      id = themes.indexOf(stored) !== -1 ? stored : null;
    }
    if (!id) {
      id = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "ember"
        : "parchment";
    }
    document.documentElement.setAttribute("data-theme", id);
    if (font) document.documentElement.setAttribute("data-editor-font", font);
    if (size) document.documentElement.style.setProperty("--editor-size", size + "px");
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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
