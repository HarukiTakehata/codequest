// Monaco's default ESM editor worker resolves the TypeScript foreign module through
// AMD (`require.toUrl`), which Vite does not provide. Importing the TypeScript worker
// directly installs its create() factory in the same worker and keeps JS IntelliSense
// without a runtime CDN or a broken dynamic module path.
import "monaco-editor/esm/vs/language/typescript/ts.worker";
