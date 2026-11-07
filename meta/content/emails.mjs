// The prospect's emails, sent by /api/lead only when PROSPECT_EMAIL_FROM is set in Vercel (README: Prospect emails).
// Plain words from a person; replies welcome (they go to PROSPECT_REPLY_TO, or the sender). The copy rules apply here
// too (tools/copy-lint.mjs). Placeholders: {firstName}, {score}, {tier}, {gaps}, {business}, {service}, {city},
// {turnaround}, {day}, {window}, {hours}, {phone}, {signoff}.
export default {
  "report": {
    "subject": "Your Review Engine score: {score}/100",
    "lines": [
      "Hi {firstName},",
      "Thanks for taking the Gap Check. Your Review Engine score is {score}/100: {tier}. Higher means a bigger gap.",
      "Your three biggest gaps:",
      "{gaps}",
      "Your Gap Report is next. We'll compare {business} with the top three for {service} in {city} and email it to you {turnaround}.",
      "Want to walk through it together? Reply with a good time for a 15-minute call.",
      "{signoff}"
    ]
  },
  "call": {
    "subject": "You're booked: {day}, {window}",
    "lines": [
      "Hi {firstName},",
      "You're booked for a 15-minute call on {day}, {window} ({hours}, your time). We'll call {phone}.",
      "Can you reply YES to confirm?",
      "We'll walk through your Gap Report for {business} and what we'd run for you. Bring whoever runs the office: it saves you passing it all on later.",
      "If the time stops working, reply and we'll move it.",
      "{signoff}"
    ]
  },
  "signoff": "The Rempo team",
  "unsubscribe": "Reply \"unsubscribe\" and we won't email you again."
};
