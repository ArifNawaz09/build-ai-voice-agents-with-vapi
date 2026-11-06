// lib/verify.js  (Chapter 6)
// Rejects any webhook that does not carry our shared secret.
// Accepts the current Bearer Token credential header:
//   Authorization: Bearer <VAPI_WEBHOOK_SECRET>
// and the legacy header (a credential named X-Vapi-Secret):
//   x-vapi-secret: <VAPI_WEBHOOK_SECRET>

import crypto from "node:crypto";

// Hash both sides first so the buffers always have equal length,
// then compare in constant time.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifyVapi(req, res, next) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[auth] VAPI_WEBHOOK_SECRET is not set");
    return res.status(500).json({ error: "server not configured" });
  }

  const auth = req.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const legacy = req.get("x-vapi-secret") ?? "";

  const ok =
    (bearer !== "" && safeEqual(bearer, secret)) ||
    (legacy !== "" && safeEqual(legacy, secret));

  if (!ok) {
    console.warn(`[auth] rejected webhook from ${req.ip}`);
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
