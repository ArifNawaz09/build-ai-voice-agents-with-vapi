// lib/vapi.js
// Tiny client for the Vapi REST API. Uses Node 20's native fetch.
// Usage: await vapiRequest("/assistant", { method: "POST", body })

const BASE_URL = "https://api.vapi.ai";

export async function vapiRequest(
  path,
  { method = "GET", body } = {}
) {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new Error("VAPI_API_KEY is not set (check .env)");
  }

  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    // Vapi returns a JSON error body; keep it raw so nothing is lost.
    throw new Error(
      `Vapi ${method} ${path} failed: ${res.status} ${text}`
    );
  }

  // Some endpoints (for example DELETE) can return an empty body.
  return text ? JSON.parse(text) : null;
}
