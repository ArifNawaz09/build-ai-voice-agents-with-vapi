// lib/notify.js  (Chapters 7-9)
// One place for "tell a human about this": agent alerts,
// booking confirmations, dispositions for the dialer/CRM.
// Logs always. If NOTIFY_WEBHOOK_URL is set, it also POSTs
// JSON there (Slack/Teams incoming webhook, Zapier/Make/n8n,
// or your CRM). Never throws: a failed alert must not break
// a live call.

export async function notify(event, payload = {}) {
  console.log(`[notify] ${event}`, JSON.stringify(payload));
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[notify] ${event} -> HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[notify] ${event} failed: ${err.message}`);
  }
}
