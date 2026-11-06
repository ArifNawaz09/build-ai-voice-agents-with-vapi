// scripts/create-assistant-basic.js  (Chapter 2)
// Creates a basic receptionist assistant, or updates it if you pass
// an assistant ID.
//
//   node --env-file=.env scripts/create-assistant-basic.js
//   node --env-file=.env scripts/create-assistant-basic.js <id>

import { vapiRequest } from "../lib/vapi.js";

const SYSTEM_PROMPT = `You are Riley, the receptionist for Northside
Dental, a small dental clinic. You are on a phone call.

Style:
- Speak in short sentences. One or two sentences per turn.
- Ask one question at a time.
- Never use lists, markdown or emojis. Everything you write is spoken.

Facts:
- Hours: Monday to Friday, 8 AM to 5 PM. Closed weekends.
- Address: 120 Main Street, second floor.

Task: answer questions about hours and location. If the caller wants
an appointment, take their name and a good callback number, and say
the front desk will call them back today.

When the caller has what they need, use the endCall tool. Do not say
goodbye yourself first; the tool speaks the goodbye.`;

function buildAssistant() {
  const assistant = {
    name: "Riley - Northside Dental (basic)",
    firstMessage:
      "Thanks for calling Northside Dental, this is Riley. " +
      "How can I help?",
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.3,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: [
        {
          type: "endCall",
          messages: [
            {
              type: "request-start",
              content: "Thanks for calling Northside Dental. Goodbye.",
            },
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
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    backgroundSound: "office",
    metadata: { project: "book-ch2", env: "dev" },
  };

  // The webhook server arrives in Chapter 6. Until then, leave
  // PUBLIC_BASE_URL empty and the assistant runs without one.
  if (process.env.PUBLIC_BASE_URL) {
    assistant.server = {
      url: process.env.PUBLIC_BASE_URL + "/vapi/webhook",
      credentialId: process.env.VAPI_CREDENTIAL_ID,
    };
    assistant.serverMessages = [
      "tool-calls",
      "status-update",
      "end-of-call-report",
    ];
  }

  return assistant;
}

async function main() {
  const existingId = process.argv[2];
  const body = buildAssistant();

  const result = existingId
    ? await vapiRequest(`/assistant/${existingId}`, {
        method: "PATCH",
        body,
      })
    : await vapiRequest("/assistant", { method: "POST", body });

  console.log(existingId ? "Updated assistant" : "Created assistant");
  console.log("id:  ", result.id);
  console.log("name:", result.name);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
