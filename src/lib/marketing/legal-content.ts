import {
	FREE_DAILY_MESSAGES,
	PRO_DAILY_MESSAGES,
	PRO_MONTHLY_MESSAGES,
	PRO_MONTHLY_PRICE_CENTS,
} from "@/lib/billing/plans";

/**
 * The privacy policy and membership terms as data, so /privacy and /terms and
 * their markdown twins (/privacy.md, /terms.md) render one text and can never
 * disagree. Edit the policy here; the pages only style it.
 */

/** A run of inline text: plain, bold, or a link (site-relative or mailto). */
export type LegalInline =
	| string
	| { strong: string }
	| { text: string; href: string };

export type LegalBlock =
	| { type: "h2"; text: string }
	| { type: "p"; content: LegalInline[] }
	| { type: "ul"; items: LegalInline[][] };

export interface LegalDocument {
	title: string;
	/** The dated line under the title, exactly as the page shows it. */
	byline: string;
	blocks: LegalBlock[];
}

export const PRIVACY_CONTACT_EMAIL = "spragginsdesigns@gmail.com";
const contactLink = {
	text: PRIVACY_CONTACT_EMAIL,
	href: `mailto:${PRIVACY_CONTACT_EMAIL}`,
};

export const PRIVACY_POLICY: LegalDocument = {
	title: "SureWord Privacy Policy",
	byline: "Last updated: August 28, 2026",
	blocks: [
		{
			type: "p",
			content: [
				"SureWord is a Bible study assistant available at ",
				{ text: "sureword.app", href: "/" },
				" and as native Android, macOS, and iOS apps. This policy describes what data SureWord collects, why, and what happens to it. The short version: your data exists to serve your own study, it is never sold, and it is never used for advertising.",
			],
		},
		{ type: "h2", text: "What we collect" },
		{
			type: "ul",
			items: [
				[
					{ strong: "Account information." },
					" Sign-in is handled by Clerk. We receive your email address and, if you sign in with Google, your name and profile picture.",
				],
				[
					{ strong: "Your study content." },
					" Conversations with the assistant, Bible study notes, folders and tags, saved memories, and file attachments you add to chats. This also includes verse highlights, reading plans, plan progress, and completions. These are stored on our servers so they follow your account across devices.",
				],
				[
					{ strong: "Reading activity." },
					" Which Bible chapters you read in the app, used to track reading-plan progress and personalize your Daily Cross, suggested questions, and Bible study.",
				],
				[
					{ strong: "Daily Cross personalization." },
					" The verse and guide prepared for you, its theme and selection rationale, bounded evidence summaries from your own study, and the generated devotional script, title, and audio status. This history helps SureWord avoid unhelpful repetition and keep future guidance grounded in your walk.",
				],
				[
					{ strong: "Your home church." },
					" If you use My church, we store the church you select and its public profile information, such as its name, address, phone, website, map and photo references, mission, and about text. SureWord does not request your device location for this feature.",
				],
				[
					{ strong: "Settings." },
					" Preferences such as theme, Bible translation, model choice, and notification delivery hour. If you add your own AI provider API key, it is encrypted at rest and never shown again after entry.",
				],
				[
					{ strong: "Native-app notification data." },
					" Where server push is supported, a device token, platform, timezone, delivery hour, and the enabled state for supported notifications. Android currently offers separate Daily Cross and chat-reply choices; local-only reminders do not create a server push token.",
				],
				[
					{ strong: "Product usage." },
					" Which features you use and whether they worked: screens opened, an answer finished or failed, which AI model wrote it, how long it took, a thumbs up or down and the reason chips you picked, and which app you used. These records carry the shape of your activity, never its content. They do not contain your questions, answers, notes, highlights, church, or any verse text, and SureWord does not record your screen.",
				],
			],
		},
		{ type: "h2", text: "How AI processing works" },
		{
			type: "p",
			content: [
				"When you send a message, tap a verse for an explanation, build an AI reading plan, or receive personalized Daily Cross content, the content needed for that request may be sent to an AI model provider. This can include your message, conversation context, and relevant study content such as reading activity, notes, memories, plan, or church. SureWord uses app-managed OpenAI models for built-in experiences and can use OpenAI, Anthropic, Moonshot, or OpenRouter for chat and related features when you select those providers.",
			],
		},
		{
			type: "p",
			content: [
				"If you use web search, the search query is sent to Tavily. If you use My church, your search terms and selected place are sent to Google Places, and SureWord may fetch the church's public website to find its mission and about information. For Pro Daily Cross narration, the generated devotional script is sent to ElevenLabs to create the audio. These services process the content to deliver the feature; SureWord does not use it for advertising.",
			],
		},
		{ type: "h2", text: "Where data lives" },
		{
			type: "p",
			content: [
				"Account-linked study data is stored in a managed Postgres database (Neon). File attachments and generated Daily Cross audio are stored in private blob storage (Vercel). Authentication data is held by Clerk. Product usage records are held by PostHog, which receives your account id and email so usage can be tied to an account, and never receives the content of your study. These services are hosted in the United States, and traffic is encrypted in transit.",
			],
		},
		{ type: "h2", text: "What we do not do" },
		{
			type: "ul",
			items: [
				["No advertising, and no advertising identifiers."],
				["No selling or renting of your data to anyone."],
				["No analytics profiles built from the content of your study."],
			],
		},
		{ type: "h2", text: "Deleting your data" },
		{
			type: "p",
			content: [
				"You can delete conversations, notes, memories, highlights, and your saved church inside the app, and you can archive reading plans. Deletion is immediate and permanent. To delete your entire account, including its reading and Daily Cross history and stored files, email ",
				contactLink,
				" from the address on the account and we will remove it.",
			],
		},
		{ type: "h2", text: "Children" },
		{
			type: "p",
			content: [
				"SureWord is a general-audience app and is not directed at children under 13. Accounts are created by adults; there are no ads and no social features.",
			],
		},
		{ type: "h2", text: "Changes and contact" },
		{
			type: "p",
			content: [
				"If data handling changes, this page changes with it and the date above is updated. Questions: ",
				contactLink,
				".",
			],
		},
	],
};

export const MEMBERSHIP_TERMS: LegalDocument = {
	title: "SureWord membership terms",
	byline: "September 13, 2026 · LineCrush Inc.",
	blocks: [
		{ type: "h2", text: "Free and Pro access" },
		{
			type: "p",
			content: [
				`SureWord provides Bible study tools and AI assistance. Reading, notes, highlights and saved conversations remain available on the Free plan. Free includes ${FREE_DAILY_MESSAGES} AI actions per day. Pro is $${PRO_MONTHLY_PRICE_CENTS / 100} USD per month and includes ${PRO_MONTHLY_MESSAGES} AI actions per billing period, with up to ${PRO_DAILY_MESSAGES} per day. Daily allowances reset at midnight UTC; membership settings show the corresponding local time. Unused messages do not roll over.`,
			],
		},
		{ type: "h2", text: "What uses your allowance" },
		{
			type: "p",
			content: [
				"New AI questions, regenerations, note composition, fresh verse explanations, generated reading plans and memory summaries count as AI actions. An answer and its tool calls count once. Reading saved content does not count. Included requests have size, output and processing limits; a larger study may need to be broken into smaller questions.",
			],
		},
		{ type: "h2", text: "Payments and cancellation" },
		{
			type: "p",
			content: [
				"Subscriptions renew monthly until canceled. Checkout shows your price and any applicable taxes before payment. Manage billing allows you to cancel, update payment details and view invoices. Cancellation normally keeps paid access through the end of the current paid period. Failed payments, refunds or disputes may change access; saved study material remains available on Free. These terms do not limit rights available under applicable consumer law.",
			],
		},
		{ type: "h2", text: "Personal API keys" },
		{
			type: "p",
			content: [
				"Personal API keys are optional and can be used on either plan. When you choose personal-key access, your AI provider bills the associated usage separately. Your provider's pricing, availability and terms apply. A personal key does not remove SureWord's service or abuse limits.",
			],
		},
		{ type: "h2", text: "Study responsibly" },
		{
			type: "p",
			content: [
				"SureWord's AI can make mistakes. Verify quotations and references in Scripture, read passages in context, and consider interpretations carefully. SureWord is a study aid, not a replacement for Scripture, your church or appropriate professional assistance.",
			],
		},
		{ type: "h2", text: "Privacy and help" },
		{
			type: "p",
			content: [
				"See our ",
				{ text: "Privacy Policy", href: "/privacy" },
				" for information about data handling and contact details. Plan changes will be communicated before they apply to a paid renewal.",
			],
		},
	],
};
