# Build AI Voice Agents with Vapi: companion code

Code for the book **Build AI Voice Agents with Vapi: A Code-First Guide to AI Phone Agents for Lead Qualification, Appointment Booking and Customer Support** by Muhammad Arif Nawaz.

This is an independent project. It is not affiliated with, endorsed by or sponsored by Vapi.

## What's here

```text
voice-backend/   Node.js 20+ / Express backend used in Chapters 2-12
php/webhook.php  single-file PHP version of the webhook (Chapter 6)
```

`voice-backend` grows chapter by chapter:

| Chapter | Files |
|---|---|
| 2 | `lib/vapi.js`, `scripts/create-assistant-basic.js` |
| 6 | `server.js`, `lib/verify.js`, `lib/store.js`, `handlers/*`, `tools/index.js`, `tools/getBusinessHours.js`, `samples/*.json` |
| 7 | `lib/leads.js`, `tools/saveLeadAnswers.js`, `scripts/create-assistant-lead.js`, `scripts/call-lead.js` |
| 8 | `lib/calendar.js`, `lib/time.js`, `tools/checkAvailability.js`, `tools/bookAppointment.js`, `tools/cancelAppointment.js`, `scripts/create-assistant-booking.js` |
| 9 | `tools/checkEligibility.js`, `tools/logDisposition.js`, `lib/notify.js`, `scripts/create-assistant-insurance.js` |

This repository holds the finished state, after Chapter 9.

## Quick start

```bash
cd voice-backend
npm install
cp .env.example .env      # fill in your keys
npm run dev               # node --env-file=.env server.js
```

Test a webhook locally without Vapi:

```bash
curl -X POST http://localhost:3000/vapi/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VAPI_WEBHOOK_SECRET" \
  --data @samples/tool-calls.json
```

To receive real calls, expose the server with ngrok or Cloudflare Tunnel, set `PUBLIC_BASE_URL`, and run the `create-assistant-*` scripts (Chapters 2, 7, 8 and 9).

## Notes

- `data/*.json` is a simple file store for learning. Use a real database before production (Chapter 12).
- You need your own Vapi account and provider accounts. Calls cost money.
- Vapi's API changes over time. If something here disagrees with the current docs at https://docs.vapi.ai, the docs win. Please open an issue.
- Nothing here is legal advice. Read Chapter 11 before running outbound calls.

## License

MIT. See `LICENSE`.
