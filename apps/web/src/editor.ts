import * as monaco from "monaco-editor";
// 显式加载全部语言贡献，确保 JS/Python/C++/Java/Shell 高亮可用（Vite 下按需 chunk）。
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { shellCompletions } from "./shell-completion";

// Vite 必须显式接线 Monaco worker；用户代码始终在独立 Worker 内运行。
(self as unknown as { MonacoEnvironment: { getWorker(): Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Shell 补全 provider：applet 清单来自构建期固化的教学镜像工具集。
let shellApplets: string[] = [];
if (typeof fetch !== "undefined") {
  void fetch(new URL("/shell-applets.txt", location.href))
    .then((response) => response.ok ? response.text() : "")
    .then((text) => { shellApplets = text.split("\n").map((s) => s.trim()).filter(Boolean); })
    .catch(() => undefined);
}
monaco.languages.registerCompletionItemProvider("shell", {
  triggerCharacters: [" "],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range: monaco.IRange = {
      startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
      startColumn: word.startColumn, endColumn: word.endColumn,
    };
    return {
      suggestions: shellCompletions(shellApplets, word.word).map((name) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: name,
        detail: "教学镜像 applet",
        range,
      })),
    };
  },
});

export { monaco };

export type Marker = { line: number; message: string };

export const LANG_IDS: Record<string, string> = {
  javascript: "javascript", python: "python", cpp: "cpp", shell: "shell", java: "java",
};

export function setDiagnostics(editor: monaco.editor.IStandaloneCodeEditor, markers: Marker[]): void {
  const model = editor.getModel();
  if (!model) return;
  monaco.editor.setModelMarkers(model, "codequest", markers.map((m) => ({
    severity: monaco.MarkerSeverity.Error,
    startLineNumber: m.line,
    startColumn: 1,
    endLineNumber: m.line,
    endColumn: model.getLineMaxColumn(m.line),
    message: m.message,
  })));
}
