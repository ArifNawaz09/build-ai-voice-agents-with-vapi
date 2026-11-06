// tools/checkEligibility.js  (Chapter 9)
// Applies the CAMPAIGN's screening filters on the server.
// These are example routing rules for a call center, not
// insurance law. Your buyer or carrier sets the real ones.

import { upsert } from "../lib/store.js";
import {
  businessTz, hoursFromEnv, isOpen, nextOpening, speakTime,
} from "../lib/time.js";

const PRODUCTS = ["aca", "medicare", "final_expense"];

// Each rule returns null (passes) or a reason code.
const RULES = {
  medicare: (a) =>
    a.age >= 65 || a.hasMedicare === true ? null : "not-medicare-age",
  aca: (a) => {
    if (a.age >= 65 || a.hasMedicare === true) return "medicare-age";
    if (a.currentCoverage === "medicaid") return "has-medicaid";
    return null;
  },
  final_expense: (a) =>
    a.age >= 50 && a.age <= 85 ? null : "age-outside-band",
};

function licensedStates() {
  const raw = process.env.LICENSED_STATES ?? "";
  const list = raw.split(",").map((s) => s.trim().toUpperCase());
  return new Set(list.filter(Boolean)); // empty = all states
}

function missing(field) {
  return JSON.stringify({
    eligible: null, missing: field,
    instructions: `Ask the caller for their ${field}, then ` +
      "call checkEligibility again.",
  });
}

export async function checkEligibility(args, message) {
  const callId = message.call?.id ?? "no-call";
  const product = PRODUCTS.includes(args.productLine)
    ? args.productLine : null;
  const age = Number.parseInt(args.age, 10);
  const state = String(args.state ?? "").trim().toUpperCase();

  if (!product) return missing("product line");
  if (!Number.isInteger(age) || age < 18 || age > 110) {
    return missing("age");
  }
  if (!/^[A-Z]{2}$/.test(state)) return missing("state");

  const answers = {
    productLine: product, age, state,
    hasMedicare: args.hasMedicare ?? null,
    currentCoverage: args.currentCoverage ?? "unknown",
    zip: args.zip ?? null,
  };
  const states = licensedStates();
  const reason = states.size && !states.has(state)
    ? "state-not-licensed"
    : RULES[product](answers);
  const eligible = reason === null;

  const tz = businessTz();
  const hours = hoursFromEnv("TRANSFER_HOURS", {
    start: 9, end: 18, days: "Mon,Tue,Wed,Thu,Fri",
  });
  const now = new Date();
  const agentsLive = isOpen(now, tz, hours);
  const opens = agentsLive ? null : nextOpening(now, tz, hours);

  upsert("screenings", callId, {
    ...answers, eligible, reason, agentsLive,
    phone: message.customer?.number
      ?? message.call?.customer?.number ?? null,
  });

  if (!eligible) {
    return JSON.stringify({
      eligible: false, reason,
      instructions: "Politely say this line cannot help with " +
        "their situation. Do not explain plan rules or give " +
        "advice. Offer the neutral resource in your prompt " +
        "for this reason, then call logDisposition with " +
        "NOT_ELIGIBLE and end the call.",
    });
  }
  if (agentsLive) {
    return JSON.stringify({
      eligible: true, agentsLive: true,
      instructions: "Say they may be able to speak with a " +
        "licensed agent now, and ask permission to connect " +
        "them. If yes, call transferCall. If no, offer a " +
        "callback and use logDisposition CALLBACK.",
    });
  }
  return JSON.stringify({
    eligible: true, agentsLive: false,
    nextOpen: opens ? speakTime(opens, tz, now) : null,
    instructions: "Licensed agents are offline. Offer a " +
      "callback starting at nextOpen. Ask the best time, then " +
      "call logDisposition with CALLBACK and callbackTime.",
  });
}
