import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import {
	FREE_DAILY_MESSAGES,
	PRO_DAILY_MESSAGES,
	PRO_MONTHLY_MESSAGES,
	PRO_MONTHLY_PRICE_CENTS,
} from "@/lib/billing/plans";
import { LANDING_FAQ } from "@/lib/marketing/faq";

const SITE_URL = "https://sureword.app";

// Built from the same constants the landing page renders, so the plan numbers
// and FAQ an AI assistant reads here can never disagree with the site.
// The billing flags mirror src/app/page.tsx so Pro reads "coming soon" here
// exactly when the landing page says so.
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
		? "available now from the membership page."
		: "coming soon.";
	const proPrice = `$${(PRO_MONTHLY_PRICE_CENTS / 100).toFixed(2)}`;
	const faq = LANDING_FAQ.map(
		(item) => `### ${item.question}\n\n${item.answer}`,
	).join("\n\n");

	return `# SureWord

> SureWord is a KJV Bible study app and personal Bible study companion with AI. Ask any Bible question and get answers grounded in the King James Version, read the whole Bible, keep notes and highlights, study the Hebrew and Greek behind a verse, and receive a daily devotional called Pick Up Your Cross.

SureWord treats the King James Bible as the inerrant, infallible Word of God. Answers quote and cite KJV Scripture rather than reinterpreting it. SureWord is a study aid, not a replacement for reading the Bible or for a local church, and its AI can make mistakes. It is made by LineCrush Inc.

## Features

- Ask a Bible question: answers are grounded in retrieved KJV passages, with verse citations you can open in the reader.
- Bible reader: the full KJV with red letters, section headings, cross-references, highlights and notes.
- Tap a verse: an instant explanation of any verse, plus a Words study of the original Hebrew or Greek with Strong's numbers.
- Search: exact-word search across the KJV and search of the original languages by Strong's number, word or transliteration.
- Pick Up Your Cross: a daily devotional built around a passage and the reader's own study, with an optional spoken version (Listen) for Pro members.
- Reading plans, a reading log, and a Bible timeline of people, places and events.
- Memory: SureWord can remember details a person chooses to share so later study builds on earlier study. Memories can be viewed, corrected, deleted or turned off in Settings.

## Plans

- Free: ${freePlan} Reading, notes, highlights and saved study stay available after the allowance runs out.
- SureWord Pro: ${proPrice} a month, ${PRO_DAILY_MESSAGES} AI messages a day up to ${PRO_MONTHLY_MESSAGES} a month, plus Pro features such as Listen. Pro is ${proPlan}
- Bring your own key: people with their own AI provider key can add it in Settings to use supported models, billed by their provider.

## Get the app

- [Web app](${SITE_URL}): sign up free and use SureWord in the browser.
- [Android app (APK)](${ANDROID_APK_URL}): the native Android app, always the latest release.
- [macOS app (DMG)](${MACOS_DMG_URL}): the native Mac app, always the latest release.

## Pages

- [Home](${SITE_URL}): what SureWord is, plans and FAQ.
- [Sign up](${SITE_URL}/sign-up): create a free account.
- [Privacy policy](${SITE_URL}/privacy)
- [Terms of service](${SITE_URL}/terms)

## FAQ

${faq}
`;
}

// Regenerated hourly so a billing flag change shows up without a redeploy.
export const revalidate = 3600;

export function GET(): Response {
	return new Response(buildLlmsTxt(), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
