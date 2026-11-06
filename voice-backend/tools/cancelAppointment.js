// tools/cancelAppointment.js  (Chapter 8)
// Two-step on purpose: first call (no bookingId, or no
// confirmed:true) only LOOKS UP. Second call cancels.

import { calendarConfig, cancel, upcomingForPhone } from
  "../lib/calendar.js";
import { normalizePhone } from "../lib/leads.js";
import { notify } from "../lib/notify.js";
import { speakTime } from "../lib/time.js";

export async function cancelAppointment(args, message) {
  const callerId = message.customer?.number
    ?? message.call?.customer?.number;
  const phone = normalizePhone(args.phone) ?? normalizePhone(callerId);
  const tz = calendarConfig().tz;
  if (!phone) {
    return JSON.stringify({
      found: 0,
      instructions: "Ask for the phone number the appointment " +
        "was booked under, then call cancelAppointment again.",
    });
  }

  if (args.bookingId && args.confirmed === true) {
    const res = await cancel(args.bookingId, phone);
    if (!res.ok) {
      return JSON.stringify({
        cancelled: false, reason: res.code,
        instructions: "Say you could not find that appointment " +
          "and offer to look it up again.",
      });
    }
    const spoken = speakTime(new Date(res.appt.start), tz);
    notify("appointment.cancelled", {
      bookingId: res.appt.id, phone, spoken,
      reason: args.reason ?? "",
    });
    return JSON.stringify({
      cancelled: true, spoken,
      instructions: "Confirm it is cancelled and offer to " +
        "book a new time.",
    });
  }

  const list = await upcomingForPhone(phone);
  if (!list.length) {
    return JSON.stringify({
      found: 0,
      instructions: "Say you found no upcoming appointment " +
        "for that number. Ask if they booked under another " +
        "number.",
    });
  }
  return JSON.stringify({
    found: list.length,
    appointments: list.slice(0, 3).map((a) => ({
      bookingId: a.id,
      name: a.name,
      reason: a.reason,
      spoken: speakTime(new Date(a.start), tz),
    })),
    instructions: "Read the appointment back (name and time) " +
      "and ask the caller to confirm. Only after a clear yes, " +
      "call cancelAppointment with that bookingId and " +
      "confirmed true. To reschedule, do not cancel: book the " +
      "new time with rescheduleOf set to this bookingId.",
  });
}
