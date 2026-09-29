import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";

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

export const metadata: Metadata = {
  title: "Ciciro",
  description: "An AI book-writing assistant and manuscript editor.",
};

const themeBoot = `
(function () {
  try {
    var themes = ["parchment", "parchment-classic", "sage", "ember", "ember-classic", "walnut", "inkwell", "candle"];
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
    var dark = id === "ember" || id === "ember-classic" || id === "walnut" || id === "inkwell" || id === "candle";
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
      className={`${newsreader.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
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
