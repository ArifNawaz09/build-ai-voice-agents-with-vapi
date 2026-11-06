// handlers/toolCalls.js  (Chapter 6)
// Runs every tool call in a tool-calls message and builds the
// exact response Vapi expects: { results: [ ... ] }, one entry
// per call, each with a flat string `result` OR `error`.

import { toolHandlers } from "../tools/index.js";

// Stay well under server.timeoutSeconds (default 20 s). A spoken
// "I couldn't check that" beats dead air and a Vapi timeout.
const TOOL_TIMEOUT_MS = 8000;

// Vapi needs single-line strings. Objects become JSON.
function flat(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").replace(/\s*\n\s*/g, " ").trim();
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${ms} ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout])
    .finally(() => clearTimeout(timer));
}

async function runOne(toolCall, message) {
  const name = toolCall.function?.name;
  const toolCallId = toolCall.id;
  const handler = toolHandlers[name];
  if (!handler) {
    console.warn(`[tool] unknown tool "${name}"`);
    return { name, toolCallId, error: `Unknown tool: ${name}` };
  }

  // Vapi sends arguments as an object. Parse a string defensively.
  let args = toolCall.function?.arguments ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  const started = Date.now();
  try {
    const out = await withTimeout(
      Promise.resolve(handler(args, message)),
      TOOL_TIMEOUT_MS
    );
    console.log(`[tool] ${name} ok ${Date.now() - started}ms`);
    return { name, toolCallId, result: flat(out) };
  } catch (err) {
    console.error(`[tool] ${name} failed:`, err.message);
    return { name, toolCallId, error: flat(err.message) };
  }
}

export async function handleToolCalls(message) {
  const list = message.toolCallList ?? [];
  const results = await Promise.all(
    list.map((tc) => runOne(tc, message))
  );
  return { results };
}
