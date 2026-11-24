import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Vite 必须显式接线 Monaco worker；用户代码始终在独立 Worker 内运行。
(self as unknown as { MonacoEnvironment: { getWorker(): Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export { monaco };

export type Marker = { line: number; message: string };

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
