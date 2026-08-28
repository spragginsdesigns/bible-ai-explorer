import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Privacy Policy - SureWord",
	description:
		"How SureWord handles your account, Bible study, personalization, files, and native-app data.",
};

const LAST_UPDATED = "August 28, 2026";
const CONTACT_EMAIL = "spragginsdesigns@gmail.com";

/**
 * Public privacy policy, required by the Google Play listing (and linked from
 * the Data Safety form). Kept in plain language and kept truthful - update it
 * whenever data handling actually changes.
 */
export default function PrivacyPage() {
	return (
		<main className="mx-auto max-w-2xl px-6 py-16 text-neutral-800 dark:text-neutral-300">
			<h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
				SureWord Privacy Policy
			</h1>
			<p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

			<section className="mt-8 space-y-6 text-[15px] leading-relaxed">
				<p>
					SureWord is a Bible study assistant available at{" "}
					<Link href="/" className="text-amber-700 underline dark:text-amber-400">
						sureword.app
					</Link>{" "}
					and as native Android, macOS, and iOS apps. This policy describes what
					data SureWord collects, why, and what happens to it. The short
					version: your data exists to serve your own study, it is never sold,
					and it is never used for advertising.
				</p>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					What we collect
				</h2>
				<ul className="list-disc space-y-2 pl-5">
					<li>
						<strong>Account information.</strong> Sign-in is handled by Clerk.
						We receive your email address and, if you sign in with Google, your
						name and profile picture.
					</li>
					<li>
						<strong>Your study content.</strong> Conversations with the
						assistant, Bible study notes, folders and tags, saved memories, and
						file attachments you add to chats. This also includes verse
						highlights, reading plans, plan progress, and completions. These are
						stored on our servers so they follow your account across devices.
					</li>
					<li>
						<strong>Reading activity.</strong> Which Bible chapters you read in
						the app, used to track reading-plan progress and personalize your
						Daily Cross, suggested questions, and Bible study.
					</li>
					<li>
						<strong>Daily Cross personalization.</strong> The verse and guide
						prepared for you, its theme and selection rationale, bounded
						evidence summaries from your own study, and the generated devotional
						script, title, and audio status. This history helps SureWord avoid
						unhelpful repetition and keep future guidance grounded in your walk.
					</li>
					<li>
						<strong>Your home church.</strong> If you use My church, we store the
						church you select and its public profile information, such as its
						name, address, phone, website, map and photo references, mission, and
						about text. SureWord does not request your device location for this
						feature.
					</li>
					<li>
						<strong>Settings.</strong> Preferences such as theme, Bible
						translation, model choice, and notification delivery hour. If you
						add your own AI provider API key, it is encrypted at rest and never
						shown again after entry.
					</li>
					<li>
						<strong>Native-app notification data.</strong> Where server push is
						supported, a device token, platform, timezone, delivery hour, and the
						enabled state for supported notifications. Android currently offers
						separate Daily Cross and chat-reply choices; local-only reminders do
						not create a server push token.
					</li>
				</ul>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					How AI processing works
				</h2>
				<p>
					When you send a message, tap a verse for an explanation, build an AI
					reading plan, or receive personalized Daily Cross content, the content
					needed for that request may be sent to an AI model provider. This can
					include your message, conversation context, and relevant study content
					such as reading activity, notes, memories, plan, or church. SureWord
					uses app-managed OpenAI models for built-in experiences and can use
					OpenAI, Anthropic, or Moonshot for chat and related features when you
					select those providers.
				</p>
				<p>
					If you use web search, the search query is sent to Tavily. If you use
					My church, your search terms and selected place are sent to Google
					Places, and SureWord may fetch the church&apos;s public website to find its
					mission and about information. For Pro Daily Cross narration, the
					generated devotional script is sent to ElevenLabs to create the audio.
					These services process the content to deliver the feature; SureWord
					does not use it for advertising.
				</p>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					Where data lives
				</h2>
				<p>
					Account-linked study data is stored in a managed Postgres database
					(Neon). File attachments and generated Daily Cross audio are stored in
					private blob storage (Vercel). Authentication data is held by Clerk.
					These services are hosted in the United States, and traffic is
					encrypted in transit.
				</p>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					What we do not do
				</h2>
				<ul className="list-disc space-y-2 pl-5">
					<li>No advertising, and no advertising identifiers.</li>
					<li>No selling or renting of your data to anyone.</li>
					<li>No analytics profiles built from the content of your study.</li>
				</ul>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					Deleting your data
				</h2>
				<p>
					You can delete conversations, notes, memories, highlights, and your
					saved church inside the app, and you can archive reading plans.
					Deletion is immediate and permanent. To delete your entire account,
					including its reading and Daily Cross history and stored files,
					email{" "}
					<a
						href={`mailto:${CONTACT_EMAIL}`}
						className="text-amber-700 underline dark:text-amber-400"
					>
						{CONTACT_EMAIL}
					</a>{" "}
					from the address on the account and we will remove it.
				</p>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					Children
				</h2>
				<p>
					SureWord is a general-audience app and is not directed at children
					under 13. Accounts are created by adults; there are no ads and no
					social features.
				</p>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					Changes and contact
				</h2>
				<p>
					If data handling changes, this page changes with it and the date above
					is updated. Questions:{" "}
					<a
						href={`mailto:${CONTACT_EMAIL}`}
						className="text-amber-700 underline dark:text-amber-400"
					>
						{CONTACT_EMAIL}
					</a>
					.
				</p>
			</section>
		</main>
	);
}
