import {
	FREE_DAILY_MESSAGES,
	PRO_DAILY_MESSAGES,
	PRO_MONTHLY_MESSAGES,
	PRO_MONTHLY_PRICE_CENTS,
} from "@/lib/billing/plans";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "@/lib/chat-attachment-types";
import { DEFAULT_FREE_DAILY_AUDIO_MINUTES } from "@/lib/audio-transcription-rules";

/**
 * The privacy policy, membership terms and support page as data, so /privacy,
 * /terms and /support and their markdown twins (/privacy.md, /terms.md,
 * /support.md) render one text and can never disagree. Edit the text here; the
 * pages only style it.
 *
 * Copy rules for PRIVACY_POLICY and SUPPORT_PAGE, the two pages the iPhone and
 * iPad app links to:
 *
 * - No price, no plan pitch and no purchase link. App Store guidelines 3.1.1
 *   and 3.1.3 treat a link from the app to a page that sells something as
 *   steering; prices live on /terms, which the Apple apps do not link.
 * - Every provider and data type named in the policy must match
 *   docs/ios/app-privacy.md (the App Store App Privacy answers) and the Play
 *   Data safety form (docs/PLAY_STORE.md). Change all three together, or the
 *   store records stop describing the app.
 */

/** A run of inline text: plain, bold, or a link (site-relative or mailto). */
export type LegalInline =
	| string
	| { strong: string }
	| { text: string; href: string };

export type LegalBlock =
	| { type: "h2"; text: string }
	| { type: "h3"; text: string }
	| { type: "p"; content: LegalInline[] }
	| { type: "ul"; items: LegalInline[][] };

export interface LegalDocument {
	title: string;
	/** The dated line under the title, exactly as the page shows it. */
	byline: string;
	blocks: LegalBlock[];
}

/**
 * The one public contact address, shown on /privacy, /terms and /support and
 * given on the Play and App Store records.
 */
export const PRIVACY_CONTACT_EMAIL = "spragginsdesigns@gmail.com";
const contactLink = {
	text: PRIVACY_CONTACT_EMAIL,
	href: `mailto:${PRIVACY_CONTACT_EMAIL}`,
};

/** Shared by the policy and the support FAQ so the two describe one flow. */
const DELETE_ACCOUNT_PATH = "Settings → Account → Delete account";

export const PRIVACY_POLICY: LegalDocument = {
	title: "SureWord Privacy Policy",
	byline: "Last updated: October 7, 2026",
	blocks: [
		{
			type: "p",
			content: [
				"SureWord is a Bible study assistant made by LineCrush Inc., available at ",
				{ text: "sureword.app", href: "/" },
				" and as native apps for Android, iPhone and iPad, and Mac. This policy describes what data SureWord collects, why, who else handles it, and how to delete it. The short version: your data exists to serve your own study of God's Word, it is never sold, and it is never used for advertising or to track you across other companies' apps and websites.",
			],
		},
		{ type: "h2", text: "What we collect" },
		{
			type: "ul",
			items: [
				[
					{ strong: "Account information." },
					" Sign-in is handled by Clerk. We receive your email address and an account id. If you sign in with Google, we also receive your name and profile picture. If you sign in with Apple, we receive the email address Apple shares, which may be a private relay address, and your name if you choose to share it. Clerk keeps the security records a sign-in service needs, such as session times, IP address, and device or browser type.",
				],
				[
					{ strong: "Your study content." },
					" Conversations with the assistant, Bible study notes, folders and tags, saved memories, verse highlights and their labels, verses you are learning by heart and your review progress, reading plans, plan progress, and completions. These are stored on our servers so they follow your account across devices.",
				],
				[
					{ strong: "About me and My testimony." },
					" Text you choose to write in Settings → Memory: a few words about where you are in your walk and, if you wish, how you came to faith. Your testimony is information about your religious beliefs, and we treat it as sensitive. It is private, it is never shown to or shared with anyone, and it is used only so the assistant can answer you with it in mind.",
				],
				[
					{ strong: "Voice messages." },
					" Audio files you attach to a chat or share into SureWord, such as a voice memo or a voice message saved from another app. The audio is kept in private file storage with that conversation and transcribed once, and the transcript and the recording's length are stored with it. A voice message may contain other people's voices and words, so please share only recordings you have the right to share.",
				],
				[
					{ strong: "Photos, PDFs and other files." },
					" Images, documents and text files you attach to a chat, kept in private file storage with that conversation. Where the app supports it, large photos are reduced in size on your device before upload.",
				],
				[
					{ strong: "Reading activity." },
					" Which Bible chapters you read in the app and your reading log, used to track reading-plan progress and personalize your Daily Cross, suggested questions, and Bible study.",
				],
				[
					{ strong: "Daily Cross personalization." },
					" The verse and guide prepared for you, its theme and selection rationale, bounded evidence summaries from your own study, and the generated devotional script, title, and audio. This history helps SureWord avoid unhelpful repetition and keep future guidance grounded in your walk.",
				],
				[
					{ strong: "Your home church." },
					" If you use My church, we store the church you select and its public profile information, such as its name, address, phone, website, map and photo references, mission, and about text. SureWord does not request your device location for this feature.",
				],
				[
					{ strong: "Settings." },
					" Preferences such as theme, Bible translation, model choice, web search, memory, and notification delivery hour. If you add your own AI provider API key, it is encrypted at rest and never shown again after entry.",
				],
				[
					{ strong: "Notification data." },
					" When you allow notifications that SureWord sends from its servers, we store a device push token, the platform, your timezone, the delivery hour, and which notifications you turned on (the Daily Cross and \"Your answer is ready\"). Reminders scheduled only on your device do not create a server push token.",
				],
				[
					{ strong: "Feedback you send." },
					" Messages you write in Settings → Send feedback, with their category, which app and version you used, and a reply address only if you give one. When you rate an answer, the thumb, any reason chips you pick, and an optional written reason are stored with that answer so it can be reviewed and corrected.",
				],
				[
					{ strong: "Subscription status." },
					" If you subscribe, payment is handled by the payment processor or store you used: Stripe on the web, or Google Play on Android. SureWord receives your subscription status, renewal dates, and that provider's customer and subscription identifiers. It never receives your card number.",
				],
				[
					{ strong: "Questions asked without an account." },
					" If you try SureWord from the website before signing up, we keep the questions you ask and their answers for up to 30 days so they can be saved to your account if you create one. They are filed under a random browser cookie, not your identity. To enforce the free-question limit we also keep a one-way keyed hash of your IP address, never the address itself.",
				],
				[
					{ strong: "Answers you share." },
					" When you share an answer, we keep a copy of that question and answer so the link keeps working. Anyone with the link can read it. Shared answers are hidden from search engines unless you turn on Show in search for that answer, which lets search engines list it; your name is never shown. Revoking a link takes the page down and removes it from search listings.",
				],
				[
					{ strong: "Product usage." },
					" Which features you use and whether they worked: screens opened, an answer finished or failed, which AI model wrote it, how long it took, a thumbs up or down and the reason chips you picked, sign-in attempts by method and error code, failed requests by route, which settings you changed (by name, never their values), and which app and version you used. Once you are signed in these records carry your account id (and, from the website, your email address and name), and they also carry a random identifier for your device or browser, the device type and operating system, and an approximate location (country and region) that our analytics provider derives from your IP address. They record the shape of your activity, never its content: they contain none of your questions, answers, notes, highlights, testimony, church, voice messages, or verse text, and SureWord does not record your screen.",
				],
			],
		},
		{ type: "h2", text: "How AI processing works" },
		{
			type: "p",
			content: [
				"SureWord's answers are written by AI models that outside providers run. When you send a message, tap a verse for an explanation or word study, build an AI reading plan, compose a note with AI, or receive personalized Daily Cross content, the content needed for that request is sent to the provider running the model. Depending on the request, this can include your message, the conversation so far, your attachments (images, documents, and the transcripts of voice messages), and the study context SureWord adds so the answer fits you: About me, My testimony, saved memories, highlights and their labels, relevant notes, reading activity and plan, and your church.",
			],
		},
		{
			type: "ul",
			items: [
				[
					{ strong: "OpenAI" },
					" runs SureWord's built-in models. It also turns voice messages into text, and it creates the search vectors that let SureWord find Scripture and your notes by meaning, so the text of your notes and questions is sent to OpenAI for that purpose.",
				],
				[
					{ strong: "Your own AI provider." },
					" If you add your own OpenAI, Anthropic, Moonshot (Kimi) or OpenRouter key and choose one of its models, your chat requests for that model go to that provider under your account with them, and their terms and privacy policy apply. Some of these providers process data outside the United States.",
				],
				[
					{ strong: "Tavily" },
					" receives the search query when the assistant searches the web. Web search is on unless you turn it off in Settings → Web Search.",
				],
				[
					{ strong: "Google Places" },
					" receives your search terms and the place you select when you use My church, and SureWord may fetch the church's public website to find its mission and about information.",
				],
				[
					{ strong: "ElevenLabs" },
					" receives the generated devotional script when you ask SureWord to read your Daily Cross aloud (Listen), and returns the audio.",
				],
			],
		},
		{
			type: "p",
			content: [
				"These providers process the content to deliver the feature you asked for. SureWord does not send your content to anyone for advertising and does not use it to train AI models.",
			],
		},
		{
			type: "p",
			content: [
				"Before your first AI request, the app shows a one-time notice, \"How SureWord answers you\", that names these providers and asks your permission. Nothing is sent to them until you tap Agree and continue, and the rest of the app (the Bible, search, highlights and notes) works without it. Your choice is saved with your account, so you are asked once rather than on every device. You can withdraw it at any time in Settings → AI → AI data sharing, and the app asks again before the next AI request.",
			],
		},
		{ type: "h2", text: "Notifications" },
		{
			type: "p",
			content: [
				"Notifications are optional and stay off until you allow them. Notifications sent from SureWord's servers travel through Expo's push service and then Apple Push Notification service or Google's Firebase Cloud Messaging, or through your browser's push service on the web. The morning Daily Cross notification carries the verse and its reference, and \"Your answer is ready\" carries a short preview of the answer, so those words pass through those services and can appear on your lock screen. You can turn each notification off in SureWord's settings or in your device's settings at any time.",
			],
		},
		{ type: "h2", text: "Where data lives and who handles it" },
		{
			type: "p",
			content: [
				"Account-linked study data is stored in a managed Postgres database (Neon). Vercel hosts the website and API, keeps request logs that include IP addresses, and stores file attachments, voice messages, and generated Daily Cross audio in private file storage. Authentication data is held by Clerk. Product usage records are held by PostHog. Apart from the AI, search, places, voice, notification, and payment providers named above, these are the only services that receive your data, and each handles it only to provide its service to SureWord. They are hosted in the United States, and traffic is encrypted in transit.",
			],
		},
		{ type: "h2", text: "What we do not do" },
		{
			type: "ul",
			items: [
				["No advertising, and no advertising identifiers."],
				["No tracking across other companies' apps or websites, and no data brokers."],
				["No selling or renting of your data to anyone."],
				["No analytics profiles built from the content of your study."],
			],
		},
		{ type: "h2", text: "How long we keep data" },
		{
			type: "p",
			content: [
				"Your account and study data are kept until you delete them or delete your account. Questions asked without an account are kept for up to 30 days. A shared answer is kept until you revoke it or delete your account.",
			],
		},
		{ type: "h2", text: "Deleting your data" },
		{
			type: "p",
			content: [
				"You can delete conversations, notes, memories, highlights, your testimony, and your saved church inside the app, and you can archive reading plans. Deletion is immediate and permanent.",
			],
		},
		{
			type: "p",
			content: [
				"To delete your whole account, open ",
				{ strong: DELETE_ACCOUNT_PATH },
				" in the Android, iPhone and iPad, or Mac app, or in Settings on the web at sureword.app/settings, and confirm. The moment you confirm, your account and everything stored with it are permanently deleted: your sign-in record, conversations and answers with their ratings, notes, folders and tags, memories, About me and testimony, highlights, reading history and reading log, reading plans, verses you are learning, Daily Cross history and audio, attachments and voice messages with their transcripts, your saved church, shared answer links, feedback, notification tokens, and personal API keys. A subscription bought on the web is cancelled as part of the deletion. A subscription bought through Google Play is billed by Google, so cancel it in the Google Play Store as well.",
			],
		},
		{
			type: "p",
			content: [
				"Product usage records held by PostHog are not removed by the in-app deletion; email us and we will delete them. Copies in our database provider's short-term recovery history expire on its normal schedule. If you cannot reach the app, email ",
				contactLink,
				" from the address on the account and we will delete the account for you.",
			],
		},
		{ type: "h2", text: "Children" },
		{
			type: "p",
			content: [
				"SureWord is not directed to children under 13, and we do not knowingly collect personal information from them. There are no ads and no way to message other users. If you believe a child under 13 has created an account, email ",
				contactLink,
				" and we will delete it.",
			],
		},
		{ type: "h2", text: "Changes and contact" },
		{
			type: "p",
			content: [
				"If data handling changes, this page changes with it and the date above is updated. Questions or requests about your data: ",
				contactLink,
				". For help using SureWord, see ",
				{ text: "Support", href: "/support" },
				".",
			],
		},
	],
};

export const MEMBERSHIP_TERMS: LegalDocument = {
	title: "SureWord membership terms",
	byline: "October 7, 2026 · LineCrush Inc.",
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
				"Subscriptions renew monthly until canceled. Checkout shows your price and any applicable taxes before payment. Manage billing allows you to cancel, update payment details and view invoices. Cancellation normally keeps paid access through the end of the current paid period. A subscription bought through Google Play is billed and managed by Google Play under its terms, and is canceled there. Failed payments, refunds or disputes may change access; saved study material remains available on Free. These terms do not limit rights available under applicable consumer law.",
			],
		},
		{ type: "h2", text: "Personal API keys" },
		{
			type: "p",
			content: [
				"Personal API keys are optional and can be used on either plan. When you choose personal-key access, your AI provider bills the associated usage separately. Your provider's pricing, availability and terms apply, and your requests for that provider's models are sent to it as the Privacy Policy describes. A personal key does not remove SureWord's service or abuse limits.",
			],
		},
		{ type: "h2", text: "Your account" },
		{
			type: "p",
			content: [
				`You must be at least 13 years old to use SureWord. Keep access to your sign-in method secure; you are responsible for activity on your account. You can delete your account at any time in ${DELETE_ACCOUNT_PATH}. Deletion is permanent, removes your study data as the Privacy Policy describes, and cancels a subscription bought on the web; a Google Play subscription must also be canceled in Google Play. We may limit or suspend an account that is used to abuse the service or to get around its limits.`,
			],
		},
		{ type: "h2", text: "Your content" },
		{
			type: "p",
			content: [
				"What you write, record and upload stays yours. You allow SureWord to store and process it, including sending it to the providers named in the Privacy Policy, only to provide SureWord to you. Upload only content you have the right to share, including voice messages and screenshots that contain other people's words, and do not use SureWord to break the law or to harass anyone.",
			],
		},
		{ type: "h2", text: "Study responsibly" },
		{
			type: "p",
			content: [
				"SureWord holds the King James Bible as the inerrant Word of God and its answers are meant to rest on Scripture, but the AI that writes them is not Scripture and can make mistakes. Verify quotations and references in Scripture, read passages in context, and consider interpretations carefully. SureWord is a study aid, not a replacement for Scripture, your church or appropriate professional assistance.",
			],
		},
		{ type: "h2", text: "Privacy and help" },
		{
			type: "p",
			content: [
				"See our ",
				{ text: "Privacy Policy", href: "/privacy" },
				" for information about data handling, and ",
				{ text: "Support", href: "/support" },
				" for help. Questions about these terms: ",
				contactLink,
				". Plan changes will be communicated before they apply to a paid renewal.",
			],
		},
	],
};

const audioMegabytes = Math.round(MAX_AUDIO_BYTES / (1024 * 1024));
const audioMinutes = Math.round(MAX_AUDIO_SECONDS / 60);

/**
 * The public support page (/support), which is the App Store "Support URL".
 * Same copy rules as the privacy policy: no price, no plan pitch, no purchase
 * link, because the iPhone and iPad app links here.
 */
export const SUPPORT_PAGE: LegalDocument = {
	title: "SureWord Support",
	byline: "Last updated: October 7, 2026",
	blocks: [
		{
			type: "p",
			content: [
				"SureWord is a Bible study companion that holds the King James Bible as the inerrant, infallible Word of God. It is made by LineCrush Inc. for Android, iPhone and iPad, Mac, and the web. If something is not working, or you have a question this page does not answer, we would be glad to hear from you.",
			],
		},
		{ type: "h2", text: "Contact us" },
		{
			type: "p",
			content: [
				"Email ",
				contactLink,
				". Tell us which app you use (Android, iPhone or iPad, Mac, or web) and, for a problem, what you were doing when it happened. You can also write to us from inside the app in Settings → Send feedback.",
			],
		},
		{ type: "h2", text: "Frequently asked questions" },
		{ type: "h3", text: "How do I sign in?" },
		{
			type: "p",
			content: [
				"There is no separate SureWord password to create. Enter your email address and we send you a one-time code, or continue with Google. On iPhone and iPad you can also use Sign in with Apple. Use the same method and the same address each time: a different email address, including a private relay address created by Apple's Hide My Email, opens a separate account.",
			],
		},
		{ type: "h3", text: "I did not get my sign-in code" },
		{
			type: "p",
			content: [
				"Check your spam or promotions folder, make sure the address is spelled correctly, and wait a minute before asking for a new code. If it still does not arrive, email us from that address.",
			],
		},
		{ type: "h3", text: "How do I delete my account?" },
		{
			type: "p",
			content: [
				"In the Android, iPhone and iPad, or Mac app, open ",
				{ strong: DELETE_ACCOUNT_PATH },
				" and confirm. On the web, sign in at sureword.app, open Settings, and use Delete account in the Account section. Your account and all of its study data, including conversations, notes, memories, testimony, highlights, reading history, voice messages and files, are permanently deleted the moment you confirm. A subscription bought on the web is cancelled with it; a subscription bought through Google Play must also be cancelled in the Google Play Store. If you cannot reach the app, email us from the address on the account and we will delete it for you. The ",
				{ text: "Privacy Policy", href: "/privacy" },
				" lists exactly what is deleted.",
			],
		},
		{ type: "h3", text: "How long can a voice message be?" },
		{
			type: "p",
			content: [
				`You can attach or share voice messages in OGG and Opus, MP3, M4A, WAV, or WebM, up to ${audioMegabytes} MB and ${audioMinutes} minutes each. SureWord transcribes each one once, and the assistant reads the transcript. Free accounts currently include ${DEFAULT_FREE_DAILY_AUDIO_MINUTES} minutes of voice messages in any rolling 24 hours. If a message is longer than the time you have left, SureWord tells you before transcribing anything, and the minutes come back as the 24 hours roll forward.`,
			],
		},
		{ type: "h3", text: "How are answers grounded in the King James Bible?" },
		{
			type: "p",
			content: [
				"Before the assistant writes, SureWord searches the King James text for the passages that speak to your question, by meaning and by exact words, and gives them to the model, which is instructed to quote and cite Scripture rather than reinterpret it. Every verse reference in an answer opens in the reader, so you can read it in its context. If you choose another translation in Settings, quotations follow that translation.",
			],
		},
		{
			type: "p",
			content: [
				"The AI can still make mistakes, so search the Scriptures to see whether those things are so (Acts 17:11). If an answer is wrong, tap the thumbs down and choose a reason such as Not KJV or Doctrinally off. Rated answers are reviewed and used to test and correct how SureWord answers.",
			],
		},
		{ type: "h3", text: "Does SureWord replace my Bible or my church?" },
		{
			type: "p",
			content: [
				"No. SureWord is a study aid. Read cited passages in context, examine interpretations carefully, and stay connected to your local church.",
			],
		},
		{ type: "h3", text: "Is my study private?" },
		{
			type: "p",
			content: [
				"Your conversations, notes, testimony and highlights belong to your account. They are never sold and never used for advertising. The ",
				{ text: "Privacy Policy", href: "/privacy" },
				" explains which providers process them to answer you, and how to delete them.",
			],
		},
	],
};
