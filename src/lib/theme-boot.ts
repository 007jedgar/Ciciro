/**
 * Runs inline in <head> before first paint (src/app/layout.tsx), so the page
 * opens in the stored theme and editor font instead of flashing the default.
 * Mirrors `webTheme` and the dark list in src/lib/theme.ts.
 */
export const THEME_BOOT_SCRIPT = `
(function () {
  try {
    var themes = ["parchment", "parchment-classic", "sage", "ember", "ember-classic", "walnut", "inkwell", "candle"];
    // The phone-only themes show as the web's default of their mode (webTheme in theme.ts).
    var phoneThemes = { "ciciro": "parchment", "ciciro-night": "ember" };
    var id = null;
    var font = null;
    var size = null;
    try {
      var blob = JSON.parse(localStorage.getItem("ciciro-settings") || "null");
      // Settings still at the epoch were never chosen: the theme follows the OS.
      var chosen = blob && blob.updatedAt !== "1970-01-01T00:00:00.000Z";
      var theme = chosen ? phoneThemes[blob.theme] || blob.theme : null;
      if (themes.indexOf(theme) !== -1) id = theme;
      if (blob && (blob.editorFont === "serif" || blob.editorFont === "sans")) font = blob.editorFont;
      if (blob && typeof blob.editorFontSize === "number") size = blob.editorFontSize;
    } catch (e) {}
    if (!id && !blob) {
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
    document.documentElement.setAttribute("data-mode", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "parchment");
    document.documentElement.setAttribute("data-mode", "light");
  }
})();
`;
