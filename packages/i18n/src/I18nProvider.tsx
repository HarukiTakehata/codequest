import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  getTranslator, htmlLang, isLocale, LOCALE_STORAGE_KEY, resolveLocale,
  type Locale, type TranslateFn,
} from "./dictionary";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectLocale(fallback?: Locale): Locale {
  if (typeof window === "undefined") return fallback ?? "en";
  let saved: unknown = null;
  try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* storage may be disabled */ }
  if (isLocale(saved)) return saved;
  return fallback ?? resolveLocale(saved, window.navigator.languages);
}

export function I18nProvider({ children, initialLocale, defaultLocale }: PropsWithChildren<{ initialLocale?: Locale; defaultLocale?: Locale }>) {
  const [locale, setLocale] = useState<Locale>(() => initialLocale ?? detectLocale(defaultLocale));
  const t = useMemo(() => getTranslator(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
    document.title = t("app.title");
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* storage may be disabled */ }
  }, [locale, t]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

export function useTranslation(): TranslateFn {
  return useI18n().t;
}

export { isLocale };
