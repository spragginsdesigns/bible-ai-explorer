import type { Metadata } from "next";
import BetaModulePlaceholder from "@/components/beta/BetaModulePlaceholder";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { findBetaModule } from "@/lib/beta/modules";

/**
 * A together module that has not shipped its own route yet. A module ships by adding
 * src/app/beta/together/<slug>/page.tsx, which outranks this dynamic segment.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	return betaMetadata({ title: findBetaModule("together", slug)?.title ?? "Not found" });
}

export default async function BetaTogetherModulePage({ params }: Props) {
	await requireBetaPage();
	const { slug } = await params;
	return <BetaModulePlaceholder destination="together" slug={slug} />;
}
