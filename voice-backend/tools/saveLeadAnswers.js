// tools/saveLeadAnswers.js  (Chapter 7)
// Saves the qualification answers, scores the lead on the
// server (not in the LLM), and tells the agent what to do next.

import { findById, upsert } from "../lib/store.js";
import { notify } from "../lib/notify.js";
import { businessTz, hoursFromEnv, isOpen } from "../lib/time.js";

const FIELDS = [
  "intent", "timeline", "priceRange", "area", "preApproved",
  "hasAgent", "propertyAddress", "bestCallbackTime", "notes",
];

const TIMELINE_POINTS = {
  asap: 3, "1-3_months": 3, "3-6_months": 2,
  "6-12_months": 1, over_12_months: 0, unknown: 0,
};

// Plain, explainable rules. Tune them with your agents.
export function scoreLead(a) {
  let points = TIMELINE_POINTS[a.timeline] ?? 0;
  const buying = a.intent === "buy" || a.intent === "both";
  const selling = a.intent === "sell" || a.intent === "both";
  if (buying && ["yes", "cash"].includes(a.preApproved)) points += 2;
  if (buying && a.preApproved === "in_progress") points += 1;
  if (selling && a.propertyAddress) points += 2;
  if (a.priceRange) points += 1;
  if (a.area) points += 1;
  if (a.hasAgent === true) points -= 3;
  const tier = points >= 6 ? "hot" : points >= 3 ? "warm" : "cold";
  return { points, tier };
}

function pick(args) {
  const out = {};
  for (const key of FIELDS) {
    const v = args[key];
    if (v === undefined || v === null || v === "") continue;
    out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

const NEXT = {
  offer_transfer: "Ask if they would like to talk with an agent " +
    "right now. If yes, call transferCall. If no, ask for the " +
    "best time for a callback and call saveLeadAnswers again.",
  promise_callback: "Tell them an agent will call them back " +
    "personally. Ask for the best time and call saveLeadAnswers " +
    "again with bestCallbackTime.",
  follow_up: "Tell them an agent will follow up with a few " +
    "options. Ask the best time to reach them.",
  nurture: "Thank them, say you will send some helpful " +
    "information, and wrap up politely.",
};

export async function saveLeadAnswers(args, message) {
  const callId = message.call?.id ?? "no-call";
  const vars = message.call?.assistantOverrides?.variableValues;
  const leadId = findById("calls", callId)?.leadId
    ?? vars?.leadId
    ?? `call-${callId}`; // web/test calls without a lead
  const prev = findById("leads", leadId) ?? {};
  const phone = prev.phone
    ?? message.customer?.number
    ?? message.call?.customer?.number
    ?? null;

  if (args.doNotCall === true) {
    if (phone) {
      upsert("dnc", phone, { source: "lead-call", callId });
    }
    upsert("leads", leadId, { status: "opted_out" });
    return JSON.stringify({
      saved: true,
      instructions: "Confirm they will not be called again, " +
        "apologize for the interruption, then end the call.",
    });
  }

  const answers = { ...(prev.answers ?? {}), ...pick(args) };
  const { points, tier } = scoreLead(answers);

  const agentHours = hoursFromEnv("AGENT_HOURS", {
    start: 9, end: 19, days: "Mon,Tue,Wed,Thu,Fri,Sat",
  });
  const agentsLive = Boolean(process.env.AGENT_TRANSFER_NUMBER)
    && isOpen(new Date(), businessTz(), agentHours);

  let nextStep = "nurture";
  if (tier === "hot") {
    nextStep = agentsLive ? "offer_transfer" : "promise_callback";
  } else if (tier === "warm") {
    nextStep = "follow_up";
  }

  upsert("leads", leadId, {
    phone, answers, points, tier, status: "qualified",
    qualifiedCallId: callId,
  });

  if (tier === "hot") {
    // Do not await: the caller is waiting on this response.
    notify("lead.hot", { leadId, phone, answers, callId });
  }

  return JSON.stringify({
    saved: true, tier, nextStep, instructions: NEXT[nextStep],
  });
}
