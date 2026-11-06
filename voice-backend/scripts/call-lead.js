// scripts/call-lead.js  (Chapter 7)
// Places a test call to YOUR OWN phone through the same code
// path the web form uses (consent, window, DNC, dial).
//
//   node --env-file=.env scripts/call-lead.js +15555550123 \
//     "Sam Tester" America/Phoenix
//
// The server (npm start) must be running and reachable at
// PUBLIC_BASE_URL so tool calls and reports reach it.

import { buildLead, dialLead } from "../lib/leads.js";
import { upsert } from "../lib/store.js";

const [phone, name = "Sam Tester", timezone] = process.argv.slice(2);
if (!phone) {
  console.error("Usage: call-lead.js <your phone> [name] [tz]");
  process.exit(1);
}

const { errors, lead } = buildLead({
  name,
  phone,
  timezone,
  interest: "buying",
  area: "Scottsdale",
  source: "cli-test",
  consent: true,
  consentText: "TEST: developer calling their own phone.",
});
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

upsert("leads", lead.id, lead);
const call = await dialLead(lead.id);
if (call) {
  console.log(`lead ${lead.id} -> call ${call.id} (${call.status})`);
} else {
  console.log("Not dialed. Check the reason logged above.");
}
