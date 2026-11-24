import type { Database } from "../db";
import { nowIso } from "./time";

/**
 * 清除已过期、已撤销或历史已领取批次中的 CSV 明文。
 * 由管理端读取与 Cloudflare Cron 共同调用；过期链接本身已不可访问，
 * 这里进一步满足“凭证不明文常驻”的存储要求。
 */
export async function clearExpiredIssuedBatchCredentials(db: Database, at = nowIso()) {
  return await db.prepare(`
    UPDATE issued_batches SET csv_text = NULL
    WHERE csv_text IS NOT NULL
      AND (downloaded_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at <= ?1)
  `).bind(at).run();
}
