// handlers/events.js  (Chapter 6)
// Informational events. Vapi does not wait for an answer, so the
// router acknowledges first and these run afterwards.

import { upsert, findById } from "../lib/store.js";
import { handleLeadCallEnded } from "../lib/leads.js";
import { finalizeDisposition } from "../tools/logDisposition.js";

export async function handleStatusUpdate(message) {
  const call = message.call ?? {};
  if (!call.id) return;

  // Events can arrive out of order. Never let a late status
  // overwrite a call the end-of-call-report already closed.
  const prev = findById("calls", call.id);
  const status = prev?.endedReason ? prev.status : message.status;

  upsert("calls", call.id, {
    status,
    callType: call.type ?? null,
    customerNumber:
      call.customer?.number ?? message.customer?.number ?? null,
    lastStatusAt: new Date().toISOString(),
  });
  console.log(`[status] call=${call.id} ${message.status}`);
}

function secondsBetween(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

export async function handleEndOfCallReport(message) {
  const call = message.call ?? {};
  const artifact = message.artifact ?? {};
  const analysis = message.analysis ?? {};
  if (!call.id) {
    console.warn("[report] end-of-call-report without call.id");
    return;
  }

  const record = upsert("calls", call.id, {
    status: "ended",
    endedReason: message.endedReason ?? null,
    callType: call.type ?? null,
    assistantId: call.assistantId ?? null,
    customerNumber:
      call.customer?.number ?? message.customer?.number ?? null,
    startedAt: message.startedAt ?? null,
    endedAt: message.endedAt ?? null,
    durationSeconds:
      secondsBetween(message.startedAt, message.endedAt),
    cost: message.cost ?? null,
    transcript: artifact.transcript ?? "",
    recordingUrl: artifact.recordingUrl ?? null,
    stereoRecordingUrl: artifact.stereoRecordingUrl ?? null,
    structuredOutputs: artifact.structuredOutputs ?? null,
    variableValues: artifact.variableValues ?? null,
    summary: analysis.summary ?? null,
    successEvaluation: analysis.successEvaluation ?? null,
  });

  console.log(
    `[report] call=${call.id} ${record.endedReason} ` +
      `${record.durationSeconds ?? "?"}s $${record.cost ?? "?"}`
  );

  // Chapter 7: retry no-answer/voicemail, alert agent.
  await handleLeadCallEnded(message);
  // Chapter 9: final disposition to dialer/CRM.
  await finalizeDisposition(message);
  return record;
}
