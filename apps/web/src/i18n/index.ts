import { en } from "./en";
import { zh } from "./zh";

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;
export type TranslateVars = Record<string, string | number>;
export type TranslateFn = (key: MessageKey, vars?: TranslateVars) => string;

export const LOCALE_LABELS: Record<Locale, string> = { en: "English", zh: "中文" };
export const LOCALE_STORAGE_KEY = "codequest-locale";

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, zh };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(saved: unknown, browserLanguages: readonly string[] = []): Locale {
  if (isLocale(saved)) return saved;
  for (const language of browserLanguages) {
    const tag = language.trim().toLowerCase();
    if (tag === "zh" || tag.startsWith("zh-")) return "zh";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}

export function getTranslator(locale: Locale): TranslateFn {
  const dictionary = dictionaries[locale] ?? en;
  return (key, vars) => {
    let message = dictionary[key] ?? en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        message = message.replaceAll(`{${name}}`, String(value));
      }
    }
    return message;
  };
}

export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}
