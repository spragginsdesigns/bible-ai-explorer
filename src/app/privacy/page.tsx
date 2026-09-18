import type { Metadata } from "next";
import LegalBlocks from "@/components/marketing/LegalBlocks";
import { PRIVACY_POLICY } from "@/lib/marketing/legal-content";

export const metadata: Metadata = {
	// The root layout's title template appends " | SureWord".
	title: "Privacy Policy",
	description:
		"How SureWord handles your account, Bible study, personalization, files, and native-app data.",
	alternates: {
		canonical: "/privacy",
		types: { "text/markdown": "/privacy.md" },
	},
};

/**
 * Public privacy policy, required by the Google Play listing (and linked from
 * the Data Safety form). Kept in plain language and kept truthful - update it
 * whenever data handling actually changes. The text lives in
 * src/lib/marketing/legal-content.ts, shared with /privacy.md.
 */
export default function PrivacyPage() {
	return (
		<main className="mx-auto max-w-2xl px-6 py-16 text-neutral-800 dark:text-neutral-300">
			<h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
				{PRIVACY_POLICY.title}
			</h1>
			<p className="mt-2 text-sm text-neutral-500">{PRIVACY_POLICY.byline}</p>

			<section className="mt-8 space-y-6 text-[15px] leading-relaxed">
				<LegalBlocks
					blocks={PRIVACY_POLICY.blocks}
					classNames={{
						h2: "text-xl font-semibold text-neutral-900 dark:text-neutral-100",
						link: "text-amber-700 underline dark:text-amber-400",
						list: "list-disc space-y-2 pl-5",
					}}
				/>
			</section>
		</main>
	);
}
