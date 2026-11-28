import { useEffect, useId, useRef } from "react";
import { LANG_IDS, monaco, setDiagnostics, setShellCompletionDetail } from "../editor";
import type { Lang } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";

interface Props {
  value: string;
  language: Lang;
  onChange: (value: string) => void;
  diagnostics?: { line: number; message: string }[];
  /** Course-provided TypeScript declarations for the script subset (for example `game.player.move`). */
  apiDeclaration?: string;
}

export function CodeEditor({ value, language, onChange, diagnostics = [], apiDeclaration }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const apiDeclarationPath = `codequest-course-api-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}.d.ts`;

  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.create(container.current, {
      value,
      language: LANG_IDS[language],
      theme: theme === "dark" ? "vs-dark" : "vs",
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      padding: { top: 10 },
    });
    instance.onDidChangeModelContent(() => changeRef.current(instance.getValue()));
    editor.current = instance;
    return () => { instance.dispose(); editor.current = null; };
    // 仅在挂载时创建；语言/值变化通过下方 effect 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  useEffect(() => {
    setShellCompletionDetail(t("completion.teachingApplet"));
  }, [t]);

  useEffect(() => {
    if (!apiDeclaration?.trim()) return;
    // addExtraLib is global to the JS language service. Always dispose the previous
    // handle so switching courses cannot leave stale APIs in Monaco's worker.
    const declaration = monaco.languages.typescript.javascriptDefaults.addExtraLib(
      apiDeclaration,
      apiDeclarationPath,
    );
    return () => declaration.dispose();
  }, [apiDeclaration, apiDeclarationPath]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, LANG_IDS[language]);
  }, [language]);

  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value);
  }, [value]);

  useEffect(() => {
    if (editor.current) setDiagnostics(editor.current, diagnostics);
  }, [diagnostics]);

  return <div className="code-editor" ref={container} aria-label={t("editor.label")} />;
}
