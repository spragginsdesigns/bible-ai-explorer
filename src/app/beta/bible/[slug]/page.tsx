import type { Metadata } from "next";
import BetaModulePlaceholder from "@/components/beta/BetaModulePlaceholder";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { findBetaModule } from "@/lib/beta/modules";

/**
 * A bible module that has not shipped its own route yet. A module ships by adding
 * src/app/beta/bible/<slug>/page.tsx, which outranks this dynamic segment.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	return betaMetadata({ title: findBetaModule("bible", slug)?.title ?? "Not found" });
}

export default async function BetaBibleModulePage({ params }: Props) {
	await requireBetaPage();
	const { slug } = await params;
	return <BetaModulePlaceholder destination="bible" slug={slug} />;
}
