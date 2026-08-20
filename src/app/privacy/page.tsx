import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Privacy Policy - SureWord",
	description: "How SureWord handles your account, conversations, notes, and study data.",
};

const LAST_UPDATED = "August 19, 2026";
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
						file attachments you add to chats. These are stored on our servers
						so they follow your account across devices.
					</li>
					<li>
						<strong>Reading activity.</strong> Which Bible chapters you read in
						the app, used only to personalize your daily verse and suggested
						questions.
					</li>
					<li>
						<strong>Settings.</strong> Preferences such as theme, Bible
						translation, model choice, and notification delivery hour. If you
						add your own AI provider API key, it is encrypted at rest and never
						shown again after entry.
					</li>
					<li>
						<strong>Push notification token.</strong> On Android, if you enable
						the daily verse notification, a device push token and your chosen
						delivery hour and timezone.
					</li>
				</ul>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					How AI processing works
				</h2>
				<p>
					When you send a message, tap a verse for an explanation, or use your
					daily verse, the relevant content (your message, conversation context,
					and any content needed to answer, such as notes you reference) is sent
					to an AI model provider to generate the response - OpenAI by default,
					or Anthropic or Moonshot if you select their models. If you use the
					web search feature, your search query is sent to Tavily. These
					providers process the content to produce a response; we do not permit
					them to use it for advertising.
				</p>

				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					Where data lives
				</h2>
				<p>
					Study data is stored in a managed Postgres database (Neon) and file
					attachments in private blob storage (Vercel), both in the United
					States. Authentication data is held by Clerk. All traffic is
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
					You can delete individual conversations, notes, and memories (or clear
					all memories) inside the app at any time; deletion is immediate and
					permanent. To delete your entire account and everything it contains,
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
