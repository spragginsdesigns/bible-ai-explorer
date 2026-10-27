import type { Metadata } from "next";
import BetaModulePlaceholder from "@/components/beta/BetaModulePlaceholder";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { findBetaModule } from "@/lib/beta/modules";

/**
 * A learn module that has not shipped its own route yet. A module ships by adding
 * src/app/beta/learn/<slug>/page.tsx, which outranks this dynamic segment.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	return betaMetadata({ title: findBetaModule("learn", slug)?.title ?? "Not found" });
}

export default async function BetaLearnModulePage({ params }: Props) {
	await requireBetaPage();
	const { slug } = await params;
	return <BetaModulePlaceholder destination="learn" slug={slug} />;
}
