import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

test("verifies a correct password and rejects a wrong one", async () => {
  const hash = await hashPassword("hunter2!hunter2!");
  assert.equal(await verifyPassword(hash, "hunter2!hunter2!"), true);
  assert.equal(await verifyPassword(hash, "hunter3!hunter3!"), false);
});

test("hashes are salted: same input, different output", async () => {
  assert.notEqual(await hashPassword("same-input-pw"), await hashPassword("same-input-pw"));
});

test("parameters are embedded in the hash string", async () => {
  const hash = await hashPassword("whatever-pw!");
  assert.match(hash, /^\$argon2id\$/);
  assert.match(hash, /m=19456,t=2,p=1/);
});
