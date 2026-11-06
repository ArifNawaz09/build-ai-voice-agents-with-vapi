// server.js  (Chapter 6)
// Express app that receives every Vapi server message.
//
//   VAPI_WEBHOOK_SECRET=... node server.js
//   node --env-file=.env server.js

import express from "express";
import { verifyVapi } from "./lib/verify.js";
import { routeMessage } from "./handlers/router.js";
import { handleLeadIntake } from "./lib/leads.js";

const app = express();

// End-of-call reports carry full transcripts; 1 MB is too small.
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/vapi/webhook", verifyVapi, async (req, res) => {
  const message = req.body?.message;
  if (!message?.type) {
    return res.status(400).json({ error: "missing message.type" });
  }

  const callId = message.call?.id ?? "no-call-id";
  const started = Date.now();

  try {
    const { status, body } = await routeMessage(message);
    res.status(status).json(body);
  } catch (err) {
    // Tool errors never land here: toolCalls.js turns them into
    // { error } results. This is for real bugs in our own code.
    console.error(`[vapi] ${message.type} call=${callId}`, err);
    res.status(500).json({ error: "internal error" });
  } finally {
    const ms = Date.now() - started;
    console.log(`[vapi] ${message.type} call=${callId} ${ms}ms`);
  }
});

// Chapter 7: web-form lead intake. Returns 202 at once, then
// dials in the background. Not behind verifyVapi: browsers
// post here, so add rate limiting before going live.
app.post("/leads", handleLeadIntake);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`voice-backend listening on http://localhost:${port}`);
  if (!process.env.VAPI_WEBHOOK_SECRET) {
    console.warn("VAPI_WEBHOOK_SECRET is not set: webhooks get 500");
  }
});
