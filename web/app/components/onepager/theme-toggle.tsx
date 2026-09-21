import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "theme";

/** Switches the token mapping in tokens.css through data-theme on <html>. The choice
 * is remembered in this browser; without one the page follows the system setting. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked: follow the system */ }
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
      setTheme(saved);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* still applies for this visit */ }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="op-theme"
      onClick={toggle}
      aria-label={theme === "dark" ? "Light theme" : "Dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {theme === "dark"
          ? <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
          : <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />}
      </svg>
    </button>
  );
}
