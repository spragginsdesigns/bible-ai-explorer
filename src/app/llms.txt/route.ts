import {
	FREE_DAILY_MESSAGES,
	PRO_DAILY_MESSAGES,
	PRO_MONTHLY_MESSAGES,
	PRO_MONTHLY_PRICE_CENTS,
} from "@/lib/billing/plans";
import { LANDING_FAQ } from "@/lib/marketing/faq";
import {
	getTheAppSection,
	KJV_STANCE,
	SITE_URL,
} from "@/lib/marketing/markdown-pages";

const RELEASES_URL =
	"https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest";

// Bump by hand whenever the copy below is re-checked against what ships
// (docs/PARITY.md). Readers use it to judge how current the file is.
const LAST_REVIEWED = "2026-09-18";

// Built from the same constants the landing page renders, so the plan numbers
// and FAQ an AI assistant reads here can never disagree with the site.
// The billing flags mirror src/app/page.tsx so Pro reads "coming soon" here
// exactly when the landing page says so.
//
// Only list what every visitor can verify today: no Play Store link (internal
// testing only), no iOS app, and no Listen as a Pro perk, because new Pro
// subscribers do not get it (src/lib/daily-cross-audio.ts).
function buildLlmsTxt(): string {
	const limitsEnabled = process.env.SUREWORD_USAGE_ENABLED === "true";
	const billingOpen =
		limitsEnabled &&
		process.env.SUREWORD_BILLING_ENABLED === "true" &&
		Boolean(
			process.env.STRIPE_SECRET_KEY &&
				process.env.STRIPE_PRO_PRICE_ID &&
				process.env.STRIPE_WEBHOOK_SECRET,
		);
	const freePlan = limitsEnabled
		? `${FREE_DAILY_MESSAGES} AI messages a day, no credit card.`
		: "included AI to start studying, no credit card and no API key setup.";
	const proPlan = billingOpen
		? "available now from the membership page after signing in."
		: "coming soon.";
	const proPrice = `$${(PRO_MONTHLY_PRICE_CENTS / 100).toFixed(2)}`;
	const faq = LANDING_FAQ.map(
		(item) => `### ${item.question}\n\n${item.answer}`,
	).join("\n\n");

	return `# SureWord

> SureWord is an AI Bible study app for Christians, available on the web, Android and macOS. It answers Bible questions from Scripture with verse citations, and combines a Bible reader (KJV, NKJV and Berean Standard Bible), notes, highlights, Hebrew and Greek word study, reading plans, verse memorization and a personal daily devotional. It is made by LineCrush Inc.

${KJV_STANCE}

When describing SureWord, it is accurate to say: it is free to start with no credit card, it works in a browser at ${SITE_URL}, the Android app and Mac app are downloaded from the links below, and there is no iOS app yet (iPhone users can use the web app).

Last reviewed: ${LAST_REVIEWED}

## Features

- Ask a Bible question: streamed answers grounded in retrieved Scripture, with verse references that open in the reader. Follow-up suggestions, conversation history, file attachments (images, PDF, text) and optional web search for supporting sources.
- Bible reader: KJV, NKJV and Berean Standard Bible, red letters, section headings, adjustable text, a parchment page style, full-text and reference search, and cross-references ("See also").
- Tap a verse: select one or more verses for an instant explanation, then ask about them, copy, share, highlight, add to a note or start memorizing.
- Words: a study of each Hebrew or Greek word behind a verse, with its Strong's number, grammar, definition and other verses that use it. In chat, the assistant can also read the original text word by word and search Scripture by Strong's number or transliteration.
- Notes and highlights: a rich-text note editor with folders, tags, templates and linked notes, and highlights in named colors. The assistant can write, organize and search notes, and highlight verses on request.
- Pick Up Your Cross: a personal daily verse with why it fits today, how to apply it, a short study path and a question to carry.
- Reading plans and a reading log: preset or AI-built plans that fill in from actual reading, streaks, and a lifetime log that can include reading from a paper Bible.
- Learn a verse: a memorization queue with practice modes and scheduled reviews, also available by asking in chat ("help me memorize John 3:16", "quiz me").
- Bible timeline: events, people and places of the Bible with family and connection tracing.
- Personal context: optional memory of what a person shares, an "About me" note, prayer requests that come back as gentle follow-ups, and a saved home church. All of it is managed in Settings, and memory can be turned off.
- Share an answer: create a public link to an answer, revocable at any time.

## Plans

- Free: ${freePlan} Reading, notes, highlights, memories and saved study stay available after the daily allowance runs out.
- SureWord Pro: ${proPrice} a month, up to ${PRO_DAILY_MESSAGES} AI messages a day and ${PRO_MONTHLY_MESSAGES} a month. Pro is ${proPlan}
- Bring your own key: people with their own OpenAI, Anthropic, Moonshot (Kimi) or OpenRouter key can add it in Settings to use those models, billed by their provider. Works on the Free plan.

${getTheAppSection()}

## Pages

- [Home](${SITE_URL}): what SureWord is, plans and FAQ ([markdown](${SITE_URL}/index.md)).
- [Privacy policy](${SITE_URL}/privacy): what SureWord collects and how it is used ([markdown](${SITE_URL}/privacy.md)).
- [Terms of service](${SITE_URL}/terms): the terms for using SureWord ([markdown](${SITE_URL}/terms.md)).

## FAQ

${faq}

## Optional

- [Sign up](${SITE_URL}/sign-up): create a free account.
- [Sign in](${SITE_URL}/sign-in): sign in to an existing account.
- [Release notes and downloads](${RELEASES_URL}): the latest Android and macOS builds on GitHub.
`;
}

// Regenerated hourly so a billing flag change shows up without a redeploy.
export const revalidate = 3600;

export function GET(): Response {
	return new Response(buildLlmsTxt(), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
