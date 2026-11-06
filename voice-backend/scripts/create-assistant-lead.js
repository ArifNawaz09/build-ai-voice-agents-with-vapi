// scripts/create-assistant-lead.js  (Chapter 7)
// Creates (or updates) the outbound real-estate lead qualifier
// and its "Lead Qualification" structured output.
//
//   node --env-file=.env scripts/create-assistant-lead.js
//
// Re-run after editing: with LEAD_ASSISTANT_ID in .env it
// PATCHes the assistant instead of creating a duplicate.

import { vapiRequest } from "../lib/vapi.js";

const COMPANY = process.env.COMPANY_NAME || "Brightway Realty";
const CALLBACK = process.env.CALLBACK_NUMBER_SPOKEN
  || "five five five, five five five, zero one zero zero";

// ---------- part 1: structured output ----------

const leadOutput = {
  name: "Lead Qualification",
  type: "ai",
  description: "Qualification answers from a real-estate " +
    "speed-to-lead call, for the agent who follows up.",
  schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["buy", "sell", "both", "rent", "unknown"],
      },
      timeline: {
        type: "string",
        enum: ["asap", "1-3_months", "3-6_months",
          "6-12_months", "over_12_months", "unknown"],
      },
      priceRange: { type: "string" },
      area: { type: "string" },
      preApproved: {
        type: "string",
        enum: ["yes", "no", "in_progress", "cash", "unknown"],
      },
      hasAgent: { type: "boolean" },
      tier: {
        type: "string",
        enum: ["hot", "warm", "cold", "not_reached"],
        description: "hot = moving within 3 months and ready " +
          "(pre-approved, cash, or has a home to list); " +
          "cold = no timeline or already has an agent.",
      },
      optedOut: {
        type: "boolean",
        description: "Caller asked not to be called again.",
      },
      bestCallbackTime: { type: "string" },
      objections: { type: "array", items: { type: "string" } },
      summary: {
        type: "string",
        description: "Two sentences an agent reads before " +
          "calling back.",
      },
    },
    required: ["intent", "tier", "optedOut", "summary"],
  },
};

async function saveOutput() {
  // Reuse the saved one. To change its schema, edit it in the
  // dashboard, or clear LEAD_OUTPUT_ID to create a new one.
  const id = process.env.LEAD_OUTPUT_ID;
  if (id) return id;
  const created = await vapiRequest("/structured-output", {
    method: "POST", body: leadOutput,
  });
  return created.id;
}

// ---------- part 2: system prompt ----------

const PROMPT = `# Identity
You are Ava, an AI assistant calling for ${COMPANY}, a real
estate team. You are calling {{firstName}}, who filled out a
form on our website about {{interest}} a home in {{area}}. They
submitted it a minute ago, so they expect a call.

# Goal
Find out, in a natural conversation:
1. Buying, selling, or both.
2. Timeline: when they want to move.
3. Price range (buyers: budget; sellers: expected price).
4. Area or neighborhoods.
5. Buyers: pre-approved for a mortgage, or paying cash?
   Sellers: the address of the home.
6. Whether they already work with a real estate agent.
Then call saveLeadAnswers and follow its instructions.

# Opening
- The caller speaks first. Reply: "Hi, is this {{firstName}}?"
- If yes: "This is Ava, an AI assistant with ${COMPANY}.
  You just asked about homes on our site, so I'm calling to
  connect you with the right agent. Got two minutes?"
- Bad time: ask when is better, call saveLeadAnswers with
  bestCallbackTime, then end the call.
- Wrong person or wrong number: apologize and end the call.

# Style
- One question per turn. One or two short sentences.
- Brief, varied acknowledgments: "Got it." "Makes sense."
- Say prices like people do: "around four fifty" or "four
  hundred fifty thousand". Never read symbols.
- Vague answer? Accept it. Never push more than once.
- No lists, markdown, or emojis. Everything is spoken.

# Guardrails
- Asked if you are a person: say you are an AI assistant for
  ${COMPANY} and a licensed agent will follow up personally.
- Never invent listings, prices, rates, or market facts. Say
  the agent will cover that.
- No mortgage, legal, or tax advice. Never ask for income,
  credit score, or Social Security number.
- If they say stop, remove me, or do not call: call
  saveLeadAnswers with doNotCall true (intent and timeline
  "unknown" if you do not know them), then follow it.
- Callback number if asked: ${CALLBACK}.

# Saving and next step
- When you have intent and timeline, plus whatever else they
  shared, say "One sec" and call saveLeadAnswers.
- Map words to values: "right away", "this month" = asap;
  "spring", "in a few months" = 3-6_months; "just looking",
  "someday" = over_12_months.
- Follow the instructions field in the result exactly.
- Call transferCall ONLY if nextStep was offer_transfer AND
  the caller clearly said yes.

# Ending
- Thank them by first name, then call endCall. Do not say
  goodbye yourself; the endCall tool says it.`;

// ---------- part 3: tools ----------

const saveLeadAnswersTool = {
  type: "function",
  function: {
    name: "saveLeadAnswers",
    description: "Save the lead's answers and get the next " +
      "step. Call when intent and timeline are known, again " +
      "if you learn a callback time, and with doNotCall true " +
      "if they ask not to be called.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["buy", "sell", "both", "rent", "unknown"],
        },
        timeline: {
          type: "string",
          enum: ["asap", "1-3_months", "3-6_months",
            "6-12_months", "over_12_months", "unknown"],
          description: "When they want to move",
        },
        priceRange: {
          type: "string",
          description: "In their words, e.g. 'around 450k'",
        },
        area: {
          type: "string",
          description: "City, neighborhood, or ZIP code",
        },
        preApproved: {
          type: "string",
          enum: ["yes", "no", "in_progress", "cash", "unknown"],
          description: "Buyers only",
        },
        hasAgent: {
          type: "boolean",
          description: "Already working with an agent",
        },
        propertyAddress: {
          type: "string",
          description: "Sellers only: home they want to sell",
        },
        bestCallbackTime: { type: "string" },
        notes: { type: "string" },
        doNotCall: {
          type: "boolean",
          description: "True only if they ask to stop calls",
        },
      },
      required: ["intent", "timeline"],
    },
  },
  messages: [{
    type: "request-response-delayed",
    timingMilliseconds: 2500,
    content: "Just a moment.",
  }],
};

function transferTool() {
  if (!process.env.AGENT_TRANSFER_NUMBER) return null;
  return {
    type: "transferCall",
    destinations: [{
      type: "number",
      number: process.env.AGENT_TRANSFER_NUMBER,
      description: "On-duty agent, for hot leads who agreed " +
        "to talk now",
      message: "Great, connecting you now. One moment.",
      transferPlan: {
        // Twilio-only: the agent hears this before the caller
        // joins. Other providers fall back to a blind transfer.
        mode: "warm-transfer-say-message",
        message: "Hot web lead, {{firstName}}, about " +
          "{{interest}} in {{area}}. Details are in your " +
          "alerts. Connecting now.",
      },
    }],
  };
}

const endCallTool = {
  type: "endCall",
  messages: [{
    type: "request-start",
    content: "Thanks again, and have a great day!",
  }],
};

// ---------- part 4: the assistant ----------

function buildAssistant(outputId) {
  const tools = [saveLeadAnswersTool, transferTool(), endCallTool]
    .filter(Boolean);
  return {
    name: "Ava - Lead Qualifier",
    // Outbound: let the person say "Hello?" first. Some
    // carriers report "answered" while still ringing.
    firstMessageMode: "assistant-waits-for-user",
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.3,
      messages: [{ role: "system", content: PROMPT }],
      tools,
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    transcriber: {
      provider: "deepgram", model: "nova-3", language: "en",
    },
    // If they pick up and stay silent, speak first anyway.
    hooks: [{
      on: "customer.speech.timeout",
      options: { timeoutSeconds: 4, triggerMaxCount: 1 },
      do: [{
        type: "say",
        exact: `Hi, this is Ava with ${COMPANY}. ` +
          "Is this a good time?",
      }],
    }],
    voicemailDetection: {
      provider: "vapi",
      backoffPlan: {
        maxRetries: 5, startAtSeconds: 2, frequencySeconds: 2.5,
      },
      beepMaxAwaitSeconds: 25,
    },
    voicemailMessage: `Hi {{firstName}}, this is Ava, an AI ` +
      `assistant with ${COMPANY}, about the form you sent us. ` +
      `Call us back at ${CALLBACK}. To stop calls, call that ` +
      "number and say stop. Thanks!",
    silenceTimeoutSeconds: 20,
    maxDurationSeconds: 420,
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
    metadata: { project: "book-ch7" },
  };
}

async function main() {
  if (!process.env.PUBLIC_BASE_URL) {
    throw new Error("Set PUBLIC_BASE_URL first (Chapter 6)");
  }
  const outputId = await saveOutput();
  const body = buildAssistant(outputId);
  const id = process.env.LEAD_ASSISTANT_ID;
  const result = id
    ? await vapiRequest(`/assistant/${id}`, { method: "PATCH", body })
    : await vapiRequest("/assistant", { method: "POST", body });

  console.log("Add these to .env:");
  console.log(`LEAD_OUTPUT_ID=${outputId}`);
  console.log(`LEAD_ASSISTANT_ID=${result.id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
