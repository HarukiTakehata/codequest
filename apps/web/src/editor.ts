import * as monaco from "monaco-editor";
// 显式加载全部语言贡献，确保 JS/Python/C++/Java/Shell 高亮可用（Vite 下按需 chunk）。
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Vite 必须显式接线 Monaco worker；用户代码始终在独立 Worker 内运行。
(self as unknown as { MonacoEnvironment: { getWorker(): Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

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
