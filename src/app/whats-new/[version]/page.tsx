import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WhatsNewShell from "@/components/whats-new/WhatsNewShell";
import { findEntry, WHATS_NEW_ENTRIES } from "@/lib/whats-new";

/** One permalink per release, all built at deploy time. */
export const dynamicParams = false;

export function generateStaticParams() {
	return WHATS_NEW_ENTRIES.map((entry) => ({ version: entry.version }));
}

export async function generateMetadata({ params }: { params: Promise<{ version: string }> }): Promise<Metadata> {
	const entry = findEntry((await params).version);
	if (!entry) return {};
	return {
		title: `${entry.version}: ${entry.title}`,
		description: entry.headline ?? entry.sections[0]?.items[0],
		alternates: { canonical: `/whats-new/${entry.version}` },
	};
}

export default async function WhatsNewReleasePage({ params }: { params: Promise<{ version: string }> }) {
	const entry = findEntry((await params).version);
	if (!entry) notFound();
	return <WhatsNewShell initialVersion={entry.version} />;
}
