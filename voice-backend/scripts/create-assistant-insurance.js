// scripts/create-assistant-insurance.js  (Chapter 9)
// Creates (or updates) the inbound insurance screener with a
// warm transfer to licensed agents, plus its QA output.
//
//   node --env-file=.env scripts/create-assistant-insurance.js
//
// Attach it to the campaign's inbound number in the dashboard.
// Warm-transfer modes that speak to the agent are Twilio-only.

import { vapiRequest } from "../lib/vapi.js";

const COMPANY = process.env.COMPANY_NAME || "Clearpath Benefits";
const TZ = process.env.BUSINESS_TZ || "America/New_York";

// Your compliance team supplies the exact Medicare wording.
const MEDICARE_DISCLAIMER = process.env.MEDICARE_DISCLAIMER || "";
if (!MEDICARE_DISCLAIMER) {
  console.warn("MEDICARE_DISCLAIMER is empty. Do not take live " +
    "Medicare calls until compliance has supplied it.");
}

// ---------- part 1: structured output (QA) ----------

const screeningOutput = {
  name: "Screening Result",
  type: "ai",
  description: "Outcome and compliance check of an inbound " +
    "insurance screening call.",
  schema: {
    type: "object",
    properties: {
      productLine: {
        type: "string",
        enum: ["aca", "medicare", "final_expense", "unknown"],
      },
      age: { type: "integer" },
      state: { type: "string", description: "2-letter code" },
      currentCoverage: { type: "string" },
      eligible: { type: "boolean" },
      transferred: { type: "boolean" },
      disposition: {
        type: "string",
        enum: ["TRANSFERRED", "CALLBACK", "NOT_ELIGIBLE",
          "NOT_INTERESTED", "DNC", "WRONG_NUMBER", "HUNG_UP",
          "OTHER"],
      },
      dncRequested: { type: "boolean" },
      complianceFlags: {
        type: "array",
        items: { type: "string" },
        description: "Each moment the assistant gave advice, " +
          "quoted a price, promised savings or benefits, " +
          "implied a government link, asked for sensitive " +
          "data, or skipped a required disclaimer. Empty if " +
          "none.",
      },
      summary: { type: "string" },
    },
    required: ["disposition", "dncRequested", "complianceFlags",
      "summary"],
  },
};

async function saveOutput() {
  const id = process.env.INSURANCE_OUTPUT_ID;
  if (id) return id;
  const created = await vapiRequest("/structured-output", {
    method: "POST", body: screeningOutput,
  });
  return created.id;
}

// ---------- part 2: system prompt ----------

const NOW = `{{"now" | date: "%A %I:%M %p", "${TZ}"}}`;

const PROMPT = `# Identity
You are Sam, a virtual intake assistant for ${COMPANY}, a
licensed insurance agency. People call this line from our ads
about health insurance, Medicare, or final expense coverage.
Your only job: ask a few screening questions, then connect
eligible callers with a licensed agent. You are NOT licensed.
You never sell, recommend, compare, or explain insurance.
Office time now: ${NOW}.

# Questions, one at a time, in this order
1. Which coverage: health insurance for under 65, Medicare,
   or final expense (burial) coverage.
2. Medicare callers only: read the Medicare disclaimer below,
   word for word, before any other question.
3. Their age.
4. The state they live in.
5. Current coverage: none, through work, Medicaid, Medicare,
   a marketplace plan, or something else.
6. Medicare callers only: do they have Medicare Part A and B?
Then call checkEligibility and follow its instructions.

# Medicare disclaimer
"${MEDICARE_DISCLAIMER}"

# Never
- Recommend or compare plans, carriers, or amounts.
- Say anything is free, zero dollars, or will save money, or
  that they qualify for subsidies, benefits, or extras.
- Quote prices, premiums, deductibles, or drug coverage.
- Ask for a Social Security number, Medicare number, bank or
  card details, health conditions, or medications. If they
  start sharing: "Please don't share that with me. The
  licensed agent will handle it securely."
- Claim to be Medicare, the government, or HealthCare.gov.
  If asked: "No, we are a private licensed agency, not
  connected with the government or the Medicare program."
- Coverage or cost questions: "That's a question for the
  licensed agent. I can connect you."

# Not eligible: neutral resources only
- not-medicare-age: HealthCare.gov.
- medicare-age: Medicare.gov, or 1-800-MEDICARE.
- has-medicaid: their state Medicaid office.
- state-not-licensed, age-outside-band: "We aren't able to
  help with that on this line."
Then call logDisposition with NOT_ELIGIBLE.

# Transfer
- Ask first: "Can I connect you with a licensed agent now?
  Please stay on the line while I do."
- On a clear yes, call transferCall. Do not call
  logDisposition for transfers; that is recorded for you.

# Do not call
If they ask to stop calls, be removed, or not be contacted:
say you will add their number to the do-not-call list, call
logDisposition with DNC, and follow it. Never argue.

# Other endings: logDisposition first, then endCall
- Wants a callback: CALLBACK, with callbackTime.
- Not interested: NOT_INTERESTED. Wrong number: WRONG_NUMBER.

# Style
- One question per turn. Short, warm, plain sentences.
- Many callers are older. Speak clearly; repeat patiently.
- No lists, markdown, or emojis.
- After endCall is called, say nothing more; it says goodbye.`;

// ---------- part 3: tools ----------

const wait = [{
  type: "request-response-delayed",
  timingMilliseconds: 2000,
  content: "Thanks, one moment.",
}];

const checkEligibilityTool = {
  type: "function",
  function: {
    name: "checkEligibility",
    description: "Check whether the caller fits this campaign " +
      "and whether licensed agents are available now.",
    parameters: {
      type: "object",
      properties: {
        productLine: {
          type: "string",
          enum: ["aca", "medicare", "final_expense"],
          description: "aca = health insurance under 65",
        },
        age: { type: "integer" },
        state: {
          type: "string",
          description: "2-letter code, e.g. TX",
        },
        currentCoverage: {
          type: "string",
          enum: ["none", "employer", "medicaid", "medicare",
            "marketplace", "other", "unknown"],
        },
        hasMedicare: {
          type: "boolean",
          description: "Has Medicare Part A and B",
        },
        zip: { type: "string" },
      },
      required: ["productLine", "age", "state"],
    },
  },
  messages: wait,
};

const logDispositionTool = {
  type: "function",
  function: {
    name: "logDisposition",
    description: "Record how the call ended. Not for transfers.",
    parameters: {
      type: "object",
      properties: {
        disposition: {
          type: "string",
          enum: ["CALLBACK", "NOT_ELIGIBLE", "NOT_INTERESTED",
            "DNC", "WRONG_NUMBER", "OTHER"],
        },
        callbackTime: {
          type: "string",
          description: "When they want a call, in their words",
        },
        notes: { type: "string" },
      },
      required: ["disposition"],
    },
  },
  messages: wait,
};

// ---------- part 4: warm transfer ----------

const BRIEFING = "You brief a licensed insurance agent who " +
  "is about to take a transferred call. In two short " +
  "sentences give: coverage type, caller's first name, age, " +
  "state, current coverage, and what they asked about. No " +
  "greeting, no filler.";

function transferTool() {
  return {
    type: "transferCall",
    destinations: [{
      type: "number",
      number: process.env.AGENT_TRANSFER_NUMBER,
      description: "Licensed agent line. Only for callers " +
        "checkEligibility marked eligible who agreed.",
      message: "Thank you. Connecting you with a licensed " +
        "agent now. Please stay on the line.",
      transferPlan: {
        mode: process.env.TRANSFER_MODE || "warm-transfer-" +
          "wait-for-operator-to-speak-first-and-then-say-summary",
        timeout: 45,
        summaryPlan: {
          enabled: true,
          messages: [
            { role: "system", content: BRIEFING },
            { role: "user",
              content: "Transcript:\n\n{{transcript}}" },
          ],
        },
      },
    }],
  };
}

// ---------- part 5: the assistant ----------

function buildAssistant(outputId) {
  return {
    name: "Sam - Insurance Screener",
    firstMessage: `Thank you for calling ${COMPANY}. I'm Sam, ` +
      "a virtual assistant. This call is recorded for quality " +
      "and compliance. Are you calling about health " +
      "insurance, Medicare, or final expense coverage?",
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.2,
      messages: [{ role: "system", content: PROMPT }],
      tools: [
        checkEligibilityTool, logDispositionTool, transferTool(),
        { type: "endCall", messages: [{ type: "request-start",
          content: "Thank you for calling. Take care!" }] },
      ],
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    transcriber: {
      provider: "deepgram", model: "nova-3", language: "en",
    },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    artifactPlan: {
      recordingEnabled: true,
      structuredOutputIds: [outputId],
    },
    server: {
      url: process.env.PUBLIC_BASE_URL + "/vapi/webhook",
      credentialId: process.env.VAPI_CREDENTIAL_ID,
    },
    serverMessages: [
      "tool-calls", "status-update", "end-of-call-report",
    ],
    metadata: { project: "book-ch9" },
  };
}

async function main() {
  for (const key of ["PUBLIC_BASE_URL", "AGENT_TRANSFER_NUMBER"]) {
    if (!process.env[key]) throw new Error(`Set ${key} first`);
  }
  const outputId = await saveOutput();
  const body = buildAssistant(outputId);
  const id = process.env.INSURANCE_ASSISTANT_ID;
  const result = id
    ? await vapiRequest(`/assistant/${id}`, { method: "PATCH", body })
    : await vapiRequest("/assistant", { method: "POST", body });

  console.log("Add these to .env:");
  console.log(`INSURANCE_OUTPUT_ID=${outputId}`);
  console.log(`INSURANCE_ASSISTANT_ID=${result.id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
