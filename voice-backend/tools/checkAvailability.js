// tools/checkAvailability.js  (Chapter 8)
// Returns a few open slots, each with an ISO "start" for the
// model to pass back and a "spoken" form to read aloud.

import { calendarConfig, findOpenSlots } from "../lib/calendar.js";
import { speakZone } from "../lib/time.js";

const PARTS = ["morning", "afternoon", "evening", "any"];

export async function checkAvailability(args) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "")
    ? args.date
    : undefined;
  const partOfDay = PARTS.includes(args.partOfDay)
    ? args.partOfDay
    : "any";

  const found = await findOpenSlots({ date, partOfDay, limit: 3 });
  const zone = speakZone(calendarConfig().tz);

  if (!found.slots.length) {
    return JSON.stringify({
      available: false,
      instructions: "Say there are no openings in the next two " +
        "weeks for that request. Offer a different part of the " +
        "day, or offer to take a message for the office.",
    });
  }

  const note = found.requestedDayAvailable
    ? "Offer these times."
    : "The requested day is full. Say so, then offer these.";
  return JSON.stringify({
    available: true,
    timezone: zone,
    slots: found.slots,
    instructions: `${note} Read the 'spoken' text, at most ` +
      "three options. Name the timezone only if the caller " +
      "is not local. When the " +
      "caller picks one, pass its exact 'start' value to " +
      "bookAppointment. Never make up a start value.",
  });
}
