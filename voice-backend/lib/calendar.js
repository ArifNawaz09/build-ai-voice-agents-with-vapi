// lib/calendar.js  (Chapter 8)
// Provider-agnostic booking logic. The rules (opening hours,
// slot size, notice, double-booking checks) live here. A
// "provider" only stores events: the JSON store below, or a
// Google Calendar / Cal.com adapter with the same 4 methods.

import crypto from "node:crypto";
import { readAll, findById, upsert } from "./store.js";
import {
  businessTz, hoursFromEnv, isOpen, localDateKey, speakTime,
  zonedParts, zonedTimeToUtc,
} from "./time.js";

// ---------- provider interface ----------
//   listBusy(from, to)  -> [{ start: Date, end: Date }]
//   createEvent(appt)   -> { eventId }
//   deleteEvent(appt)   -> void
//   findByPhone(phone, after) -> [appt]   (booked, upcoming)

export const jsonProvider = {
  async listBusy(from, to) {
    return readAll("appointments")
      .filter((a) => a.status === "booked")
      .map((a) => ({ start: new Date(a.start), end: new Date(a.end) }))
      .filter((b) => b.start < to && b.end > from);
  },
  async createEvent(appt) {
    upsert("appointments", appt.id, appt);
    return { eventId: appt.id };
  },
  async deleteEvent(appt) {
    upsert("appointments", appt.id, {
      status: "cancelled", cancelledAt: new Date().toISOString(),
    });
  },
  async findByPhone(phone, after) {
    return readAll("appointments")
      .filter((a) => a.phone === phone && a.status === "booked")
      .filter((a) => new Date(a.start) > after)
      .sort((a, b) => a.start.localeCompare(b.start));
  },
};

let provider = jsonProvider;
export function useProvider(p) {
  provider = p;
}

// ---------- configuration ----------

export function calendarConfig() {
  const env = process.env;
  return {
    tz: businessTz(),
    hours: hoursFromEnv("OPEN_HOURS", {
      start: 9, end: 17, days: "Mon,Tue,Wed,Thu,Fri",
    }),
    slotMin: Number(env.SLOT_MINUTES ?? 30),
    noticeMin: Number(env.MIN_NOTICE_MINUTES ?? 120),
    horizonDays: Number(env.BOOKING_HORIZON_DAYS ?? 14),
  };
}

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// All slot start times for one local day ("2026-11-10").
function daySlots(dateKey, cfg) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const out = [];
  const first = cfg.hours.start * 60;
  const last = cfg.hours.end * 60 - cfg.slotMin;
  for (let t = first; t <= last; t += cfg.slotMin) {
    const start = zonedTimeToUtc(
      y, m, d, Math.floor(t / 60), t % 60, cfg.tz
    );
    if (isOpen(start, cfg.tz, cfg.hours)) out.push(start);
  }
  return out;
}

function partOk(date, tz, part) {
  const h = zonedParts(date, tz).hour;
  if (part === "morning") return h < 12;
  if (part === "afternoon") return h >= 12 && h < 17;
  if (part === "evening") return h >= 17;
  return true;
}

// Pick n slots spread across the list, not n in a row.
function spread(list, n) {
  if (list.length <= n) return list;
  const step = (list.length - 1) / (n - 1);
  return Array.from(
    { length: n }, (_, i) => list[Math.round(i * step)]
  );
}

function overlaps(start, end, busy) {
  return busy.some((b) => start < b.end && end > b.start);
}

// ---------- queries ----------

// Free slots on `date` (or the next days that have any).
export async function findOpenSlots(
  { date, partOfDay = "any", limit = 3 } = {}, now = new Date()
) {
  const cfg = calendarConfig();
  const earliest = new Date(now.getTime() + cfg.noticeMin * MIN);
  const horizon = new Date(now.getTime() + cfg.horizonDays * DAY);
  const today = localDateKey(now, cfg.tz);
  const startKey = date && date >= today ? date : today;

  // Walk forward from noon of the start day, one day at a time.
  // (Noon + 24h always lands on the next local day, even
  // across a DST change.)
  const [y, m, d] = startKey.split("-").map(Number);
  const first = zonedTimeToUtc(y, m, d, 12, 0, cfg.tz);
  const nextDay = (t) => new Date(t.getTime() + DAY);
  for (let cur = first; cur < horizon; cur = nextDay(cur)) {
    const key = localDateKey(cur, cfg.tz);
    const all = daySlots(key, cfg).filter(
      (s) => s >= earliest && partOk(s, cfg.tz, partOfDay)
    );
    if (!all.length) continue;
    const dayEnd = new Date(all.at(-1).getTime() + cfg.slotMin * MIN);
    const busy = await provider.listBusy(all[0], dayEnd);
    const free = all.filter((s) => !overlaps(
      s, new Date(s.getTime() + cfg.slotMin * MIN), busy
    ));
    if (!free.length) continue;
    return {
      requestedDate: date ?? null,
      requestedDayAvailable: !date || key === date,
      slots: spread(free, limit).map((s) => ({
        start: s.toISOString(),
        spoken: speakTime(s, cfg.tz, now),
      })),
    };
  }
  return { requestedDate: date ?? null, slots: [] };
}

export async function upcomingForPhone(phone, now = new Date()) {
  return provider.findByPhone(phone, now);
}

// ---------- writes, one at a time ----------

// A promise chain is a simple in-process lock: two callers
// grabbing the same slot are serialized. With more than one
// server process, enforce this in the database or provider.
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function validSlot(start, cfg, now) {
  if (Number.isNaN(start.getTime())) return "bad_time";
  const end = new Date(start.getTime() + cfg.slotMin * MIN);
  const lastMinute = new Date(end.getTime() - MIN);
  if (!isOpen(start, cfg.tz, cfg.hours)) return "closed";
  if (!isOpen(lastMinute, cfg.tz, cfg.hours)) return "closed";
  if (zonedParts(start, cfg.tz).minute % cfg.slotMin !== 0) {
    return "bad_time";
  }
  if (start < new Date(now.getTime() + cfg.noticeMin * MIN)) {
    return "too_soon";
  }
  if (start > new Date(now.getTime() + cfg.horizonDays * DAY)) {
    return "too_far";
  }
  return null;
}

export function book(input, now = new Date()) {
  return withLock(async () => {
    const cfg = calendarConfig();
    const start = new Date(input.start);
    const problem = validSlot(start, cfg, now);
    if (problem) return { ok: false, code: problem };
    const end = new Date(start.getTime() + cfg.slotMin * MIN);

    // Idempotency: the same call booking the same slot twice
    // (model retry, webhook retry) gets the same appointment.
    const repeat = readAll("appointments").find((a) =>
      a.status === "booked" && a.callId === input.callId &&
      a.start === start.toISOString());
    if (repeat) return { ok: true, appt: repeat, repeated: true };

    const busy = await provider.listBusy(start, end);
    if (overlaps(start, end, busy)) {
      return { ok: false, code: "slot_taken" };
    }

    const appt = {
      id: crypto.randomUUID(),
      start: start.toISOString(),
      end: end.toISOString(),
      tz: cfg.tz,
      name: input.name,
      phone: input.phone,
      reason: input.reason ?? "",
      callId: input.callId ?? null,
      status: "booked",
    };
    const { eventId } = await provider.createEvent(appt);
    appt.eventId = eventId;
    upsert("appointments", appt.id, { eventId });

    // Reschedule = book the new slot first, then free the old
    // one. If anything fails, the caller still has a booking.
    if (input.rescheduleOf) {
      await cancelUnlocked(input.rescheduleOf, input.phone);
    }
    return { ok: true, appt };
  });
}

async function cancelUnlocked(bookingId, phone) {
  const appt = findById("appointments", bookingId);
  if (!appt || appt.status !== "booked") {
    return { ok: false, code: "not_found" };
  }
  // Only the phone that booked it may cancel it.
  if (phone && appt.phone !== phone) {
    return { ok: false, code: "not_owner" };
  }
  await provider.deleteEvent(appt);
  return { ok: true, appt };
}

export function cancel(bookingId, phone) {
  return withLock(() => cancelUnlocked(bookingId, phone));
}
