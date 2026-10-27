import type { Metadata } from "next";
import BetaModulePlaceholder from "@/components/beta/BetaModulePlaceholder";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { findBetaModule } from "@/lib/beta/modules";

/**
 * A library module that has not shipped its own route yet. A module ships by adding
 * src/app/beta/library/<slug>/page.tsx, which outranks this dynamic segment.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	return betaMetadata({ title: findBetaModule("library", slug)?.title ?? "Not found" });
}

export default async function BetaLibraryModulePage({ params }: Props) {
	await requireBetaPage();
	const { slug } = await params;
	return <BetaModulePlaceholder destination="library" slug={slug} />;
}
