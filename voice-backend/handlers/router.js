// handlers/router.js  (Chapter 6)
// Decides what to do with each server message, by message.type.
// Returns { status, body } for server.js to send.

import { handleToolCalls } from "./toolCalls.js";
import { handleAssistantRequest } from "./assistantRequest.js";
import {
  handleStatusUpdate,
  handleEndOfCallReport,
} from "./events.js";

const ok = (body = { received: true }) => ({ status: 200, body });

// Informational events: answer Vapi at once, do the work after.
function inBackground(label, work) {
  Promise.resolve()
    .then(work)
    .catch((err) => console.error(`[${label}] failed:`, err));
}

export async function routeMessage(message) {
  switch (message.type) {
    // Vapi waits for these two. Answer with real content, fast.
    case "tool-calls":
      return ok(await handleToolCalls(message));
    case "assistant-request":
      return ok(await handleAssistantRequest(message));

    // Vapi does not wait for these. Acknowledge, then process.
    case "status-update":
      inBackground("status-update", () => handleStatusUpdate(message));
      return ok();
    case "end-of-call-report":
      inBackground("end-of-call-report", () =>
        handleEndOfCallReport(message)
      );
      return ok();

    // Anything else we did not subscribe to: accept and ignore.
    default:
      return ok();
  }
}
