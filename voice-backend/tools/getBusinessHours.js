// tools/getBusinessHours.js  (Chapter 6 demo tool)
// Returns a short, speakable sentence about opening hours.
// Signature for every tool: async (args, message) => string

// 24-hour clock, business local time. null = closed.
const HOURS = {
  Monday: [8, 17],
  Tuesday: [8, 17],
  Wednesday: [8, 17],
  Thursday: [8, 17],
  Friday: [8, 17],
  Saturday: null,
  Sunday: null,
};

function spoken(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

function localNow(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: get("weekday"), hour: Number(get("hour")) };
}

export async function getBusinessHours(args = {}, message) {
  const tz = process.env.BUSINESS_TZ || "America/New_York";
  const now = localNow(tz);
  const day = HOURS[args.day] !== undefined ? args.day : now.day;
  const hours = HOURS[day];

  const callId = message?.call?.id ?? "?";
  console.log(`[getBusinessHours] call=${callId} day=${day}`);

  if (!hours) {
    return `We are closed on ${day}. Weekday hours are ` +
      "Monday to Friday, 8 AM to 5 PM.";
  }
  const [open, close] = hours;
  const text = `On ${day} we are open ${spoken(open)} to ` +
    `${spoken(close)}.`;
  if (day !== now.day) return text;

  const isOpen = now.hour >= open && now.hour < close;
  return `${text} We are ${isOpen ? "open" : "closed"} right now.`;
}
