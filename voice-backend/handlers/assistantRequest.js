// handlers/assistantRequest.js  (Chapter 6)
// Inbound numbers with no assistant attached make Vapi ask us which
// assistant should answer. We must reply within 7.5 s end-to-end,
// so only fast, local lookups belong here.

import { findById } from "../lib/store.js";

const BUSINESS = "Northside Dental";

function systemPrompt(contact) {
  const who = contact
    ? `The caller is ${contact.name}, an existing patient.`
    : "The caller is not in our records yet.";
  return [
    `You are Riley, the receptionist for ${BUSINESS}.`,
    "You are on a phone call. Keep every reply to one or two",
    "short sentences and ask one question at a time.",
    who,
    "For opening hours, call the getBusinessHours tool. Never guess",
    "hours. When the caller is done, use the endCall tool.",
  ].join(" ");
}

function transientAssistant(contact) {
  const greeting = contact
    ? `Hi ${contact.name}, thanks for calling ${BUSINESS}. ` +
      "How can I help today?"
    : `Thanks for calling ${BUSINESS}, this is Riley. ` +
      "How can I help?";

  return {
    name: "Riley - inbound (dynamic)",
    firstMessage: greeting,
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.3,
      messages: [{ role: "system", content: systemPrompt(contact) }],
      tools: [
        {
          type: "function",
          function: {
            name: "getBusinessHours",
            description:
              "Get the clinic's opening hours and whether it is " +
              "open right now.",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "endCall",
          messages: [
            { type: "request-start", content: "Thanks. Goodbye." },
          ],
        },
      ],
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
    },
    // No `server` here on purpose: events fall back to the phone
    // number's saved server URL, which keeps its credential.
  };
}

export async function handleAssistantRequest(message) {
  const caller = message.call?.customer?.number ??
    message.customer?.number ?? "";
  const contact = caller ? findById("contacts", caller) : null;

  // Unknown caller and a saved assistant configured: use it.
  const savedId = process.env.INBOUND_ASSISTANT_ID;
  if (!contact && savedId) {
    console.log(`[assistant-request] ${caller} -> saved ${savedId}`);
    return { assistantId: savedId };
  }

  console.log(
    `[assistant-request] ${caller} -> transient ` +
      (contact ? `(known: ${contact.name})` : "(unknown)")
  );
  return { assistant: transientAssistant(contact) };
}
