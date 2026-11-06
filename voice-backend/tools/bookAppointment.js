// tools/bookAppointment.js  (Chapter 8)
// Books a slot returned by checkAvailability. Re-checks the
// slot under a lock, so two callers cannot get the same time.

import {
  book, calendarConfig, findOpenSlots,
} from "../lib/calendar.js";
import { normalizePhone } from "../lib/leads.js";
import { notify } from "../lib/notify.js";
import { localDateKey, speakTime } from "../lib/time.js";

const WHY = {
  slot_taken: "That time was just taken.",
  too_soon: "That time is too soon to book.",
  too_far: "That time is too far out to book.",
  closed: "The office is closed at that time.",
  bad_time: "That is not a valid appointment time.",
};

export async function bookAppointment(args, message) {
  const callId = message.call?.id ?? null;
  const callerId = message.customer?.number
    ?? message.call?.customer?.number;
  const phone = normalizePhone(args.phone) ?? normalizePhone(callerId);
  const name = String(args.name ?? "").trim();

  if (!name || !phone) {
    return JSON.stringify({
      booked: false,
      instructions: "Ask for the missing details (full name, " +
        "and a phone number for the confirmation text), then " +
        "call bookAppointment again.",
    });
  }

  const res = await book({
    start: args.start, name, phone, callId,
    reason: args.reason, rescheduleOf: args.rescheduleOf,
  });

  if (!res.ok) {
    // Hand back fresh options so the model can recover in
    // one turn instead of calling checkAvailability again.
    const t = new Date(args.start);
    const day = Number.isNaN(t.getTime())
      ? undefined
      : localDateKey(t, calendarConfig().tz);
    const alt = await findOpenSlots({ date: day, limit: 3 });
    return JSON.stringify({
      booked: false,
      reason: res.code,
      alternatives: alt.slots,
      instructions: `${WHY[res.code] ?? "That did not work."} ` +
        "Apologize briefly and offer the alternatives.",
    });
  }

  const { appt } = res;
  const spoken = speakTime(new Date(appt.start), calendarConfig().tz);
  if (!res.repeated) {
    // Fire and forget: SMS/email goes out after the reply.
    notify("appointment.booked", {
      bookingId: appt.id, name, phone, start: appt.start,
      spoken, reason: appt.reason, rescheduleOf:
        args.rescheduleOf ?? null,
    });
  }
  return JSON.stringify({
    booked: true,
    bookingId: appt.id,
    spoken,
    instructions: "Confirm the day and time once, say a text " +
      "confirmation is on the way, and ask if there is " +
      "anything else.",
  });
}
