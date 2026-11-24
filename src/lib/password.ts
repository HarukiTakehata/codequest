import { base64UrlToBytes, bytesToBase64Url, constantTimeEqual } from "./crypto";

// Cloudflare Workers WebCrypto 上限 100k（boardroom docs/auth.md 同款约束）。
const ITERATIONS = 100_000;
const KEY_BYTES = 32;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password) as unknown as BufferSource, "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" }, key, KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 100_000) return false;
  try {
    const salt = base64UrlToBytes(parts[2]!);
    return constantTimeEqual(parts[3]!, bytesToBase64Url(await derive(password, salt, iterations)));
  } catch {
    return false;
  }
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return "密码至少 10 个字符";
  if (password.length > 200) return "密码最多 200 个字符";
  return null;
}

export function temporaryPassword(): string {
  // 固定字母前缀同时避免 base64url 的 '-' 前缀被电子表格当作公式。
  return `Cq!${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
}
