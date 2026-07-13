import { useEffect } from "react";
import { isLocale, type Locale, setLocale as setI18nLocale } from "../i18n";
import { useStickyState } from "./useStickyState";

export const useAppPreferences = () => {
  const [theme, setTheme] = useStickyState("muro-theme", "light", {
    parse: (raw) => raw || "light",
    serialize: (value) => String(value),
  });
  const [locale, setLocale] = useStickyState<Locale>("muro-locale", "en", {
    parse: (raw) => (isLocale(raw) ? raw : "en"),
    serialize: (value) => value,
  });
  const [seekMode, setSeekMode] = useStickyState<"fast" | "accurate">(
    "muro-seek-mode",
    "fast",
    {
      parse: (raw) => (raw === "accurate" ? "accurate" : "fast"),
      serialize: (value) => value,
    }
  );

  useEffect(() => {
    setI18nLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return { locale, seekMode, setLocale, setSeekMode, setTheme, theme };
};
