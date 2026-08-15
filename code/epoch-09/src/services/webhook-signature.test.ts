import { test } from "node:test";
import assert from "node:assert/strict";
import { signWebhook, verifyWebhook } from "./webhook-signature.ts";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ event: "task.completed", id: "abc" });

test("a signed payload verifies", () => {
  const header = signWebhook(SECRET, BODY);
  assert.equal(verifyWebhook(SECRET, BODY, header), true);
});

test("a tampered body fails verification", () => {
  const header = signWebhook(SECRET, BODY);
  assert.equal(verifyWebhook(SECRET, BODY + "x", header), false);
});

test("a wrong secret fails verification", () => {
  const header = signWebhook(SECRET, BODY);
  assert.equal(verifyWebhook("whsec_other", BODY, header), false);
});

test("an expired timestamp fails verification (replay defense)", () => {
  const old = Math.floor(Date.now() / 1000) - 3600;
  const header = signWebhook(SECRET, BODY, old);
  assert.equal(verifyWebhook(SECRET, BODY, header), false);
});
