// lib/time.js  (Chapters 7-9)
// Timezone helpers built only on Intl.DateTimeFormat.
// No date library: Node 20 ships full ICU timezone data.

const cache = new Map();

function formatter(tz) {
  if (!cache.has(tz)) {
    cache.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }));
  }
  return cache.get(tz);
}

// True if tz is a valid IANA name such as "America/Chicago".
export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Wall-clock parts of an instant, as seen in a timezone.
export function zonedParts(date, tz) {
  const p = {};
  for (const part of formatter(tz).formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday, // "Mon", "Tue", ...
  };
}

// "2026-11-10" for the local calendar day in tz.
export function localDateKey(date, tz) {
  const p = zonedParts(date, tz);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

// Convert a wall-clock time in tz to a real instant (Date).
// Two correction passes handle DST offsets correctly.
export function zonedTimeToUtc(y, mo, d, h, mi, tz) {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const seen = Date.UTC(
      p.year, p.month - 1, p.day, p.hour, p.minute
    );
    guess += target - seen;
  }
  return new Date(guess);
}

// Is `date` inside opening hours? Hours are local to tz.
// days: e.g. ["Mon","Tue","Wed","Thu","Fri"]
export function isOpen(date, tz, { start, end, days }) {
  const p = zonedParts(date, tz);
  if (days && !days.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= start * 60 && minutes < end * 60;
}

// Read opening hours from env, e.g. CALL_WINDOW_START=9,
// CALL_WINDOW_END=20, CALL_WINDOW_DAYS=Mon,Tue,Wed,Thu,Fri
// Read at call time (not import time) so .env is loaded.
export function hoursFromEnv(prefix, def) {
  const env = process.env;
  const days = (env[`${prefix}_DAYS`] ?? def.days)
    .split(",")
    .map((d) => d.trim());
  return {
    start: Number(env[`${prefix}_START`] ?? def.start),
    end: Number(env[`${prefix}_END`] ?? def.end),
    days,
  };
}

export function businessTz() {
  return process.env.BUSINESS_TZ || "America/New_York";
}

// First instant at or after `date` that is inside the hours.
// Steps in 15-minute increments for up to 8 days.
export function nextOpening(date, tz, hours) {
  const step = 15 * 60 * 1000;
  let t = Math.ceil(date.getTime() / step) * step;
  const limit = t + 8 * 24 * 60 * 60 * 1000;
  for (; t < limit; t += step) {
    if (isOpen(new Date(t), tz, hours)) return new Date(t);
  }
  return null;
}

// Speakable time: "today at 2:30 PM", "tomorrow at 9 AM",
// "Tuesday, November 10 at 4 PM". Whole hours drop ":00".
export function speakTime(date, tz, now = new Date()) {
  const p = zonedParts(date, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const mins = p.minute === 0
    ? ""
    : ":" + String(p.minute).padStart(2, "0");
  const clock = `${h12}${mins} ${ampm}`;

  const day = localDateKey(date, tz);
  const today = localDateKey(now, tz);
  const tmrw = localDateKey(
    new Date(now.getTime() + 24 * 60 * 60 * 1000), tz
  );
  if (day === today) return `today at ${clock}`;
  if (day === tmrw) return `tomorrow at ${clock}`;

  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
  return `${label} at ${clock}`;
}

// "Eastern Time", "Central Time"... for saying the zone once.
export function speakZone(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longGeneric",
    }).formatToParts(date);
    const name = parts.find((x) => x.type === "timeZoneName");
    return name ? name.value : tz;
  } catch {
    return tz;
  }
}
