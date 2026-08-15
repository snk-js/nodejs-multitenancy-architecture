export function makeSessionRepository(db) {
  return {
    async create({ token_hash, user_id, expires_at }) {
      await db.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        [token_hash, user_id, expires_at]
      );
    },

    async findValid(token_hash) {
      const { rows } = await db.query(
        "SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()",
        [token_hash]
      );
      return rows[0] ?? null;
    },

    async delete(token_hash) {
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [token_hash]);
    },
  };
}
