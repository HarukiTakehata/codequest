import { describe, expect, it } from "vitest";
import wabt from "wabt";
import { executeCpp, runTemplateWasm } from "../src/template";
import type { RunRequest } from "@codequest/judge";

const WAT = `(module
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_read" (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 0) "\\64\\00\\00\\00\\0e\\00\\00\\00")
  (data (i32.const 100) "c-template-ok\\n")
  (func (export "_start")
    (i32.store (i32.const 20) (i32.const 0))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 20)))
    (drop (call $fd_read (i32.const 0) (i32.const 32) (i32.const 1) (i32.const 40)))
  )
)`;

async function compile(): Promise<Uint8Array> {
  const w = await wabt();
  const module = w.parseWat("template.wat", WAT);
  module.resolveNames();
  module.validate();
  return new Uint8Array(module.toBinary({ log: false, write_debug_names: false }).buffer);
}

describe("C/C++ template mode (design §5.2 fallback, M3 deferred)", () => {
  it("executes a real wasm module through the minimal WASI shim", async () => {
    const result = await runTemplateWasm(await compile(), "stdin-data");
    expect(result).toMatchObject({ stdout: "c-template-ok\n", stderr: "", exitCode: 0 });
  });

  it("is reached via the unified run request using a base64 template", async () => {
    const bytes = await compile();
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const request: RunRequest = {
      lang: "cpp", code: "// 模板题：预编译 wasm 由课程包下发", stdin: "x", timeoutMs: 5000,
      files: { "__template_wasm_base64": btoa(binary) },
    };
    const result = await executeCpp(request);
    expect(result.stdout).toBe("c-template-ok\n");
    expect(result.exitCode).toBe(0);
  });

  it("returns an explicit message when wasm-clang assets are unavailable", async () => {
    const result = await executeCpp({ lang: "cpp", code: "int main(){}", stdin: "", timeoutMs: 5000 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("wasm-clang");
  });
});
