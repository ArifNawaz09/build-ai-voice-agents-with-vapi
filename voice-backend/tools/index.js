// tools/index.js
// The one place that maps a tool name (exactly as in the tool
// schema and the prompt) to its handler function.
// Every handler: async (args, message) => string

import { getBusinessHours } from "./getBusinessHours.js";
import { saveLeadAnswers } from "./saveLeadAnswers.js";
import { checkAvailability } from "./checkAvailability.js";
import { bookAppointment } from "./bookAppointment.js";
import { cancelAppointment } from "./cancelAppointment.js";
import { checkEligibility } from "./checkEligibility.js";
import { logDisposition } from "./logDisposition.js";

export const toolHandlers = {
  getBusinessHours, // Chapter 6 demo
  saveLeadAnswers, // Chapter 7
  checkAvailability, // Chapter 8
  bookAppointment,
  cancelAppointment,
  checkEligibility, // Chapter 9
  logDisposition,
};
