/** 首个管理员领取门闩与 boardroom 同构：数据库层保证并发只有一个赢家。 */
export function bootstrapClaim(db: D1Database, claimId: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO instance_settings (k, v)
     VALUES ('bootstrap_claim', CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN ?1 ELSE NULL END)`,
  ).bind(claimId);
}
