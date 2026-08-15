// Authorization lives INSIDE the query: `AND owner_id = $2` — a primary key
// is not an authorization. Zero rows ⇒ not yours (or absent) ⇒ the route
// returns 404, indistinguishable from a task that never existed.
// This pattern, scaled up, is exactly how tenant isolation works in Epoch 06+.
export function makeTaskRepository(db) {
  return {
    async listByOwner(ownerId) {
      const { rows } = await db.query(
        "SELECT id, title, done, created_at FROM tasks WHERE owner_id = $1 ORDER BY created_at DESC",
        [ownerId]
      );
      return rows;
    },

    async create({ title, ownerId }) {
      const { rows } = await db.query(
        "INSERT INTO tasks (title, owner_id) VALUES ($1, $2) RETURNING id, title, done, created_at",
        [title, ownerId]
      );
      return rows[0];
    },

    async setDone(id, ownerId, done) {
      const { rows } = await db.query(
        "UPDATE tasks SET done = $3 WHERE id = $1 AND owner_id = $2 RETURNING id, title, done, created_at",
        [id, ownerId, done]
      );
      return rows[0] ?? null;
    },
  };
}
