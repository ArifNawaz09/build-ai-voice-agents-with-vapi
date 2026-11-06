// lib/leads.js  (Chapter 7)
// Web-form lead intake, consent and calling-window checks,
// outbound dialing through Vapi, and retry after no-answer.

import crypto from "node:crypto";
import { vapiRequest } from "./vapi.js";
import { readAll, findById, upsert } from "./store.js";
import { notify } from "./notify.js";
import {
  businessTz, hoursFromEnv, isOpen, isValidTimeZone, nextOpening,
} from "./time.js";

// Conservative default: 9 AM-8 PM in the LEAD's timezone.
// The federal limit is 8 AM-9 PM; several states are stricter.
const CALL_WINDOW_DEFAULT = {
  start: 9, end: 20, days: "Mon,Tue,Wed,Thu,Fri,Sat",
};

// Minutes to wait before attempt 2, attempt 3, ...
// Some states cap attempts per day; check yours.
const RETRY_DELAYS_MIN = [10, 24 * 60];
const RETRY_REASONS = new Set([
  "customer-did-not-answer", "customer-busy", "voicemail",
]);
const CLOSED = new Set(["qualified", "transferred", "opted_out"]);

// ---------- intake ----------

export function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return "+" + digits;
  }
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) {
    return "+" + digits;
  }
  return null;
}

function truthy(v) {
  return v === true || ["true", "on", "yes", "1"].includes(String(v));
}

// Build a lead record from a form post. Returns { errors, lead }.
export function buildLead(body, req) {
  const errors = [];
  const name = String(body.name ?? "").trim();
  const phone = normalizePhone(body.phone);
  if (!name) errors.push("name is required");
  if (!phone) errors.push("phone is not a valid number");
  if (!truthy(body.consent)) {
    errors.push("consent must be given (unchecked by default)");
  }
  if (!body.consentText) {
    errors.push("consentText (the exact wording shown) is required");
  }
  const tz = isValidTimeZone(body.timezone)
    ? body.timezone
    : businessTz();

  const lead = {
    id: crypto.randomUUID(),
    name,
    phone,
    email: body.email ?? null,
    interest: body.interest ?? "unknown", // buy | sell | both
    area: body.area ?? "",
    source: body.source ?? "website",
    timezone: tz,
    consent: {
      given: truthy(body.consent),
      text: body.consentText ?? null,
      at: new Date().toISOString(),
      ip: req?.ip ?? null,
      userAgent: req?.get?.("user-agent") ?? null,
      pageUrl: body.pageUrl ?? null,
    },
    status: "new",
    attempts: 0,
    answers: {},
  };
  return { errors, lead };
}

// Same phone submitted in the last 10 minutes? Forms and lead
// portals double-post; never double-dial a fresh lead.
function isDuplicate(phone) {
  const cutoff = Date.now() - 10 * 60 * 1000;
  return readAll("leads").some(
    (l) => l.phone === phone && Date.parse(l.createdAt) > cutoff
  );
}

// ---------- checks ----------

export function checkCallable(lead, now = new Date()) {
  if (!lead.consent?.given) return { ok: false, reason: "no-consent" };
  if (findById("dnc", lead.phone)) return { ok: false, reason: "dnc" };
  if (CLOSED.has(lead.status)) return { ok: false, reason: "closed" };
  if (lead.attempts > RETRY_DELAYS_MIN.length) {
    return { ok: false, reason: "max-attempts" };
  }
  const hours = hoursFromEnv("CALL_WINDOW", CALL_WINDOW_DEFAULT);
  if (isOpen(now, lead.timezone, hours)) return { ok: true };
  const earliestAt = nextOpening(now, lead.timezone, hours);
  if (!earliestAt) return { ok: false, reason: "no-window" };
  return { ok: true, earliestAt };
}

// ---------- dialing ----------

// Spoken in the prompt: "about {{interest}} a home".
const INTEREST_WORDS = {
  buy: "buying", buying: "buying", sell: "selling",
  selling: "selling", both: "buying and selling",
};

function firstName(full) {
  return String(full ?? "").trim().split(/\s+/)[0] || "there";
}

export async function startOutboundCall(lead, { earliestAt } = {}) {
  const body = {
    assistantId: process.env.LEAD_ASSISTANT_ID,
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: { number: lead.phone, name: lead.name },
    assistantOverrides: {
      variableValues: {
        leadId: lead.id,
        firstName: firstName(lead.name),
        interest: INTEREST_WORDS[lead.interest]
          ?? "buying or selling",
        area: lead.area || "your area",
      },
    },
  };
  if (earliestAt) {
    const latest = new Date(earliestAt.getTime() + 60 * 60 * 1000);
    body.schedulePlan = {
      earliestAt: earliestAt.toISOString(),
      latestAt: latest.toISOString(),
    };
  }

  const call = await vapiRequest("/call", { method: "POST", body });
  // Remember which lead this call belongs to; tools and the
  // end-of-call report look it up by call id.
  upsert("calls", call.id, { kind: "lead", leadId: lead.id });
  upsert("leads", lead.id, {
    attempts: (lead.attempts ?? 0) + 1,
    lastCallId: call.id,
    status: earliestAt ? "scheduled" : "calling",
    nextAttemptAt: earliestAt ? earliestAt.toISOString() : null,
  });
  console.log(`[lead ${lead.id}] call ${call.id}` +
    (earliestAt ? ` scheduled ${earliestAt.toISOString()}` : ""));
  return call;
}

export async function dialLead(leadId, { notBefore } = {}) {
  const lead = findById("leads", leadId);
  if (!lead) throw new Error(`No lead ${leadId}`);
  const now = notBefore ?? new Date();
  const check = checkCallable(lead, now);
  if (!check.ok) {
    upsert("leads", leadId, { status: "not-callable",
      notCallableReason: check.reason });
    console.log(`[lead ${leadId}] not dialed: ${check.reason}`);
    return null;
  }
  // A future notBefore (retry) is a schedule too.
  const earliestAt = check.earliestAt
    ?? (now > new Date() ? now : undefined);
  return startOutboundCall(lead, { earliestAt });
}

// ---------- Express handler: POST /leads ----------

export async function handleLeadIntake(req, res) {
  const body = req.body ?? {};
  // Honeypot: a hidden "website" field only bots fill in.
  if (body.website) return res.status(202).json({ ok: true });

  const { errors, lead } = buildLead(body, req);
  if (errors.length) return res.status(400).json({ errors });
  if (isDuplicate(lead.phone)) {
    return res.status(202).json({ ok: true, duplicate: true });
  }

  upsert("leads", lead.id, lead);
  // Answer the browser first, then dial. Never make the form
  // wait on the Vapi API.
  res.status(202).json({ ok: true, leadId: lead.id });
  dialLead(lead.id).catch((err) => {
    console.error(`[lead ${lead.id}] dial failed: ${err.message}`);
    upsert("leads", lead.id, { status: "dial-error" });
  });
}

// ---------- after the call: retry or hand off ----------

export async function handleLeadCallEnded(message) {
  const callId = message.call?.id;
  const link = callId ? findById("calls", callId) : null;
  if (!link || link.kind !== "lead") return;
  let lead = findById("leads", link.leadId);
  if (!lead) return;

  const reason = message.endedReason;
  const outputs = Object.values(
    message.artifact?.structuredOutputs ?? {}
  );
  const analysis = outputs.find(
    (o) => o?.name === "Lead Qualification"
  )?.result;

  const patch = { lastEndedReason: reason };
  if (analysis) patch.postCallAnalysis = analysis;
  if (reason === "assistant-forwarded-call") {
    patch.status = "transferred";
  }
  lead = upsert("leads", lead.id, patch);

  if (RETRY_REASONS.has(reason) && !CLOSED.has(lead.status)) {
    return scheduleRetry(lead);
  }
  if (lead.status === "transferred") return;

  // Talked but no live hand-off: tell a human what happened.
  notify("lead.call-ended", {
    leadId: lead.id, name: lead.name, phone: lead.phone,
    tier: lead.tier ?? analysis?.tier ?? "unknown",
    answers: lead.answers, analysis, endedReason: reason,
    recordingUrl: message.artifact?.recordingUrl ?? null,
  });
}

async function scheduleRetry(lead) {
  const delay = RETRY_DELAYS_MIN[lead.attempts - 1];
  if (delay === undefined) {
    upsert("leads", lead.id, { status: "unreached" });
    notify("lead.unreached", {
      leadId: lead.id, name: lead.name, phone: lead.phone,
      attempts: lead.attempts,
    });
    return;
  }
  const notBefore = new Date(Date.now() + delay * 60 * 1000);
  upsert("leads", lead.id, { status: "retry-pending" });
  await dialLead(lead.id, { notBefore });
}
