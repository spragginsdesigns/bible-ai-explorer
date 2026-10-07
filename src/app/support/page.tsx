import type { Metadata } from "next";
import LegalBlocks from "@/components/marketing/LegalBlocks";
import { SUPPORT_PAGE } from "@/lib/marketing/legal-content";

export const metadata: Metadata = {
	// The root layout's title template appends " | SureWord".
	title: "Support",
	description:
		"Contact SureWord and get help with signing in, deleting your account, voice messages, and how answers are grounded in the King James Bible.",
	alternates: {
		canonical: "/support",
		types: { "text/markdown": "/support.md" },
	},
};

/**
 * Public support page: the App Store "Support URL", and one of only two pages
 * the iPhone and iPad app links to (with /privacy). Styled like /privacy. The
 * text lives in src/lib/marketing/legal-content.ts, shared with /support.md,
 * and must never carry a price or a purchase link (see the rules there).
 */
export default function SupportPage() {
	return (
		<main className="mx-auto max-w-2xl px-6 py-16 text-neutral-800 dark:text-neutral-300">
			<h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
				{SUPPORT_PAGE.title}
			</h1>
			<p className="mt-2 text-sm text-neutral-500">{SUPPORT_PAGE.byline}</p>

			<section className="mt-8 space-y-6 text-[15px] leading-relaxed">
				<LegalBlocks
					blocks={SUPPORT_PAGE.blocks}
					classNames={{
						h2: "text-xl font-semibold text-neutral-900 dark:text-neutral-100",
						h3: "pt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100",
						link: "text-amber-700 underline dark:text-amber-400",
						list: "list-disc space-y-2 pl-5",
					}}
				/>
			</section>
		</main>
	);
}
