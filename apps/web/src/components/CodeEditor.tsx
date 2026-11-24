import { useEffect, useRef } from "react";
import { monaco, setDiagnostics } from "../editor";
import type { Lang } from "../types";

const LANG_IDS: Record<Lang, string> = {
  javascript: "javascript", python: "python", cpp: "cpp", shell: "shell",
};

interface Props {
  value: string;
  language: Lang;
  onChange: (value: string) => void;
  diagnostics?: { line: number; message: string }[];
}

export function CodeEditor({ value, language, onChange, diagnostics = [] }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.create(container.current, {
      value,
      language: LANG_IDS[language],
      theme: "vs-dark",
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
    const model = editor.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, LANG_IDS[language]);
  }, [language]);

  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value);
  }, [value]);

  useEffect(() => {
    if (editor.current) setDiagnostics(editor.current, diagnostics);
  }, [diagnostics]);

  return <div className="code-editor" ref={container} aria-label="代码编辑器" />;
}
