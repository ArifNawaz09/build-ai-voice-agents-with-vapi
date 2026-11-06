// scripts/create-assistant-booking.js  (Chapter 8)
// Creates (or updates) the inbound booking receptionist and
// its "Booking Outcome" structured output.
//
//   node --env-file=.env scripts/create-assistant-booking.js
//
// Then attach it to your inbound number in the dashboard
// (Phone Numbers > your number > Assistant).

import { vapiRequest } from "../lib/vapi.js";

const OFFICE = process.env.COMPANY_NAME || "Northside Dental";
const TZ = process.env.BUSINESS_TZ || "America/New_York";

// ---------- part 1: structured output ----------

const bookingOutput = {
  name: "Booking Outcome",
  type: "ai",
  description: "What happened on an inbound booking call.",
  schema: {
    type: "object",
    properties: {
      outcome: {
        type: "string",
        enum: ["booked", "rescheduled", "cancelled",
          "question_only", "no_booking", "transferred"],
      },
      callerName: { type: "string" },
      appointmentTime: {
        type: "string",
        description: "As confirmed on the call, in words",
      },
      visitReason: { type: "string" },
      newPatient: { type: "boolean" },
      followUpNeeded: {
        type: "boolean",
        description: "Staff must call the caller back",
      },
      summary: { type: "string" },
    },
    required: ["outcome", "followUpNeeded", "summary"],
  },
};

async function saveOutput() {
  const id = process.env.BOOKING_OUTPUT_ID;
  if (id) return id; // edit in the dashboard, or clear to recreate
  const created = await vapiRequest("/structured-output", {
    method: "POST", body: bookingOutput,
  });
  return created.id;
}

// ---------- part 2: system prompt ----------

const NOW = `{{"now" | date: "%A, %B %d, %Y, %I:%M %p", "${TZ}"}}`;

const PROMPT = `# Identity
You are Riley, the virtual receptionist for ${OFFICE}. You
book, move, and cancel appointments by phone.
Right now it is ${NOW} at the office.
The caller's number is {{customer.number}}.

# Facts
- Visits are 30 minutes, Monday to Friday, 9 AM to 5 PM.
- Address: 120 Main Street, second floor. Parking behind.
- No medical or dental advice. For pain, swelling, or
  bleeding that will not stop, say: "If this is an emergency,
  please hang up and call 9 1 1."

# Booking flow
1. Ask what the visit is for and whether they have been here
   before.
2. Ask what day and part of day suits them. Work out the date
   from today's date above and pass it as YYYY-MM-DD.
3. Call checkAvailability. Offer two or three times using the
   "spoken" text. Never offer a time the tool did not return.
4. When they pick one, ask for their full name. Ask if the
   number they are calling from is best for a text
   confirmation. If not, get another and read it back in
   groups: "five five five, five five five, zero one
   two three".
5. Read back once: name, day and time, reason. On yes, call
   bookAppointment with the exact "start" value.
6. Follow the instructions in the result.

# Rescheduling and cancelling
- Call cancelAppointment WITHOUT confirmed to look up their
  booking. Read it back.
- To move it: find a new time with checkAvailability, then
  call bookAppointment with rescheduleOf set to the old
  bookingId. Never cancel first.
- To cancel: only after a clear yes, call cancelAppointment
  with the bookingId and confirmed true.

# Style
- One question at a time. One or two short sentences.
- Say times the natural way: "Tuesday at 2:30", "tomorrow at
  9". Never say "14:30" or read an ISO date. Say the timezone
  only if the caller is not local.
- No lists, markdown, or emojis.
- If you are asked whether you are a real person, say you are
  ${OFFICE}'s virtual assistant.

# Hand-off and ending
- Billing, insurance, or anything you cannot do: offer to
  transfer to the front desk and call transferCall on yes.
- When they are done, call endCall. Do not say goodbye
  yourself; the tool says it.`;

// ---------- part 3: tools ----------

const fn = (name, description, properties, required = []) => ({
  type: "function",
  function: {
    name, description,
    parameters: { type: "object", properties, required },
  },
  messages: [{
    type: "request-response-delayed",
    timingMilliseconds: 2000,
    content: "One moment while I check the schedule.",
  }],
});

const tools = [
  fn("checkAvailability",
    "Find open appointment times. Returns up to three slots.", {
      date: {
        type: "string",
        description: "YYYY-MM-DD in office time. Omit for the " +
          "soonest openings.",
      },
      partOfDay: {
        type: "string",
        enum: ["morning", "afternoon", "evening", "any"],
      },
    }),
  fn("bookAppointment",
    "Book a slot from checkAvailability after the caller " +
    "confirmed name, time, and reason.", {
      start: {
        type: "string",
        description: "Exact 'start' value from checkAvailability",
      },
      name: { type: "string", description: "Caller's full name" },
      reason: { type: "string", description: "Reason for visit" },
      phone: {
        type: "string",
        description: "Only if different from the caller's number",
      },
      rescheduleOf: {
        type: "string",
        description: "bookingId being moved, when rescheduling",
      },
    }, ["start", "name", "reason"]),
  fn("cancelAppointment",
    "Look up the caller's upcoming appointments, or cancel " +
    "one when confirmed is true.", {
      bookingId: { type: "string" },
      confirmed: {
        type: "boolean",
        description: "True only after the caller said yes",
      },
      phone: {
        type: "string",
        description: "Number it was booked under, if different",
      },
      reason: { type: "string" },
    }),
];

// ---------- part 4: the assistant ----------

function buildAssistant(outputId) {
  const frontDesk = process.env.AGENT_TRANSFER_NUMBER;
  if (frontDesk) {
    tools.push({
      type: "transferCall",
      destinations: [{
        type: "number",
        number: frontDesk,
        description: "Front desk, for billing, insurance, or " +
          "anything the assistant cannot do",
        message: "Sure, transferring you to the front desk now.",
      }],
    });
  }
  tools.push({
    type: "endCall",
    messages: [{
      type: "request-start",
      content: `Thanks for calling ${OFFICE}. Goodbye!`,
    }],
  });

  return {
    name: "Riley - Booking Receptionist",
    firstMessage: `Thanks for calling ${OFFICE}, this is ` +
      "Riley, the virtual assistant. Calls may be recorded. " +
      "Are you looking to book, change, or cancel a visit?",
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.2,
      messages: [{ role: "system", content: PROMPT }],
      tools,
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    transcriber: {
      provider: "deepgram", model: "nova-3", language: "en",
    },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
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
    metadata: { project: "book-ch8" },
  };
}

async function main() {
  if (!process.env.PUBLIC_BASE_URL) {
    throw new Error("Set PUBLIC_BASE_URL first (Chapter 6)");
  }
  const outputId = await saveOutput();
  const body = buildAssistant(outputId);
  const id = process.env.BOOKING_ASSISTANT_ID;
  const result = id
    ? await vapiRequest(`/assistant/${id}`, { method: "PATCH", body })
    : await vapiRequest("/assistant", { method: "POST", body });

  console.log("Add these to .env:");
  console.log(`BOOKING_OUTPUT_ID=${outputId}`);
  console.log(`BOOKING_ASSISTANT_ID=${result.id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
