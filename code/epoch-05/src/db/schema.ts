// The schema is TypeScript: every query's return type is INFERRED from these
// definitions. Rename a column here → every stale usage is a compile error.
import { pgTable, uuid, text, boolean, timestamp, index, customType } from "drizzle-orm/pg-core";

// citext isn't built into drizzle; a customType maps it 1:1.
const citext = customType<{ data: string }>({ dataType: () => "citext" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sessions_user_id_index").on(t.userId),
  index("sessions_expires_at_index").on(t.expiresAt),
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tasks_owner_id_created_at_index").on(t.ownerId, t.createdAt),
]);
