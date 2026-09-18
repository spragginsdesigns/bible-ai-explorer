import { FREE_DAILY_MESSAGES } from "@/lib/billing/plans";

// Single source for the landing page FAQ, its FAQPage structured data and
// /llms.txt. Google penalises markup that does not match the page, so they
// must never drift.
export const LANDING_FAQ: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "How does SureWord become more personal?",
    answer:
      "SureWord draws on your saved memories, reading history, questions and notes to give future conversations context. Suggested questions and Pick Up Your Cross can build on what you’ve been studying and what matters to you. You can also choose your Bible translation, appearance and reading goals to make the experience your own.",
  },
  {
    question: "Can I choose what SureWord remembers?",
    answer:
      "Yes. Ask it to remember, correct or forget a detail, or manage your saved memories in Settings. You can turn memory off there too. Removing a memory does not delete your notes, conversations or reading history.",
  },
  {
    question: "Can I keep using SureWord for free?",
    answer: `Yes. Reading, notes, highlights and saved study remain accessible when your included AI allowance runs out. Free includes ${FREE_DAILY_MESSAGES} messages each day, with no credit card required.`,
  },
  {
    question: "What counts as an AI message?",
    answer:
      "A new AI question, regeneration, note-composition request, fresh verse explanation, memory summary or generated reading plan counts as one action. Tools used within an answer do not count separately. Opening saved content does not use a message. Daily allowances reset at midnight UTC, shown in your local time in membership settings.",
  },
  {
    question:
      "Does the AI replace reading the Bible or being part of a church?",
    answer:
      "No. SureWord is a study aid and its AI can make mistakes. Read cited passages in context, examine interpretations carefully, and stay connected to your local church.",
  },
  {
    question: "Can I choose my own model?",
    answer:
      "Included AI uses a model selected by SureWord, so you can start immediately. Add a personal provider key in Settings to use supported models and reasoning options. Your provider bills that usage separately.",
  },
];
