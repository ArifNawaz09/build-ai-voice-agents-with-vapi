// tools/logDisposition.js  (Chapter 9)
// Records how the call ended, honors do-not-call requests,
// and pushes the result to your dialer or CRM.
// Transfers are NOT logged here: finalizeDisposition() below
// derives them from the end-of-call report.

import { findById, upsert } from "../lib/store.js";
import { notify } from "../lib/notify.js";

export const DISPOSITIONS = [
  "CALLBACK", "NOT_ELIGIBLE", "NOT_INTERESTED", "DNC",
  "WRONG_NUMBER", "OTHER",
];

const NEXT = {
  CALLBACK: "Confirm the callback time back to the caller, " +
    "thank them, and end the call.",
  NOT_ELIGIBLE: "Thank them for calling and end the call.",
  NOT_INTERESTED: "Thank them for their time and end the call.",
  DNC: "Say their number has been added to the do-not-call " +
    "list, apologize for any trouble, and end the call.",
  WRONG_NUMBER: "Apologize for the confusion and end the call.",
  OTHER: "Wrap up politely and end the call.",
};

function callerPhone(message) {
  return message.customer?.number
    ?? message.call?.customer?.number ?? null;
}

export async function logDisposition(args, message) {
  // Accept "not-eligible" as well as "NOT_ELIGIBLE".
  const disposition = String(args.disposition ?? "")
    .trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!DISPOSITIONS.includes(disposition)) {
    // Thrown errors become the tool "error" field.
    throw new Error(`disposition must be one of ${DISPOSITIONS}`);
  }
  const callId = message.call?.id ?? "no-call";
  const phone = callerPhone(message);

  const record = upsert("dispositions", callId, {
    disposition,
    callbackTime: args.callbackTime ?? null,
    notes: String(args.notes ?? "").slice(0, 500),
    phone,
    source: "ai-screener",
  });

  if (disposition === "DNC" && phone) {
    // Internal DNC list. lib/leads.js checks it before any
    // outbound dial, so the number is never called again.
    upsert("dnc", phone, { source: "insurance-inbound", callId });
  }

  notify("call.disposition", record); // not awaited
  return JSON.stringify({ logged: true, instructions:
    NEXT[disposition] });
}

// Call from handleEndOfCallReport (see INTEGRATION notes).
// Fills in a disposition when the model did not log one.
export async function finalizeDisposition(message) {
  const callId = message.call?.id;
  if (!callId) return;
  const ours = process.env.INSURANCE_ASSISTANT_ID;
  const isOurs = (ours && message.call?.assistantId === ours)
    || findById("screenings", callId);
  if (!isOurs) return;

  const reason = message.endedReason;
  const prev = findById("dispositions", callId);
  let disposition = prev?.disposition;
  if (reason === "assistant-forwarded-call") {
    disposition = "TRANSFERRED";
  } else if (!disposition) {
    disposition = reason === "customer-ended-call"
      ? "HUNG_UP" : "INCOMPLETE";
  }

  const record = upsert("dispositions", callId, {
    disposition,
    endedReason: reason,
    phone: prev?.phone ?? callerPhone(message),
    screening: findById("screenings", callId),
    durationSeconds: message.startedAt && message.endedAt
      ? Math.round((Date.parse(message.endedAt) -
          Date.parse(message.startedAt)) / 1000)
      : null,
    recordingUrl: message.artifact?.recordingUrl ?? null,
    structuredOutputs: message.artifact?.structuredOutputs ?? null,
  });
  await notify("call.final", record);
}
