import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Globe2 } from "lucide-react";
import { LOCALES, LOCALE_LABELS, type Locale } from "../i18n";
import { useI18n } from "../i18n/I18nProvider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("[data-language-toggle]")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: Locale) => {
    setLocale(next);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("[data-language-toggle]")?.focus();
  };

  return (
    <div className="language-switcher" ref={root}>
      <button
        type="button"
        className="icon-button language-toggle"
        data-language-toggle
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus());
          }
        }}
        aria-label={t("nav.switchLanguage")}
        title={t("nav.switchLanguage")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="language-switcher"
      >
        <Globe2 size={18} aria-hidden="true" />
        <span className="language-current">{LOCALE_LABELS[locale]}</span>
        <ChevronDown size={14} className={open ? "is-open" : ""} aria-hidden="true" />
      </button>
      {open && (
        <div className="dropdown-menu" id={menuId} role="menu" aria-label={t("nav.language")} onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const direction = event.key === "ArrowDown" ? 1 : -1;
          items[(current + direction + items.length) % items.length]?.focus();
        }}>
          {LOCALES.map((code) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              className={code === locale ? "is-active" : ""}
              key={code}
              onClick={() => choose(code)}
            >
              <span>{LOCALE_LABELS[code]}</span>
              {code === locale && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
