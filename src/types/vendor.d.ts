declare module "@live-codes/clang-wasm" {
  export interface ClangRunResult {
    stdout: string;
    stderr: string;
    output: string;
    errors: string[];
    exitCode: number | null;
    compileMs?: number;
    runMs?: number;
  }
  export interface ClangCompilerLike {
    run(code: string, input?: string): Promise<ClangRunResult>;
    dispose(): void;
  }
  export function createCompiler(
    language: "cpp" | "c" | "objc" | "objcpp",
    options?: { baseUrl?: string | URL },
  ): Promise<ClangCompilerLike>;
}
