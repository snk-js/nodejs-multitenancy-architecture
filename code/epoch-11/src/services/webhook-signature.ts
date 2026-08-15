import { createHmac, timingSafeEqual } from "node:crypto";

// Being a good third party: tenants must be able to verify a delivery is
// really from us, and a captured request must not be replayable forever.
// Format: X-Trellis-Signature: t=<unix-seconds>,v1=<hex hmac of "t.body">

export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  toleranceSec = 300
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=", 2) as [string, string])
  );
  const t = Number(parts["t"]);
  const v1 = parts["v1"];
  if (!Number.isFinite(t) || !v1) return false;

  // 🛡️ timestamp in the signed material → replays expire
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(v1, "hex");
  // 🛡️ secrets are compared with constant-time functions only
  return given.length === expected.length && timingSafeEqual(given, expected);
}
