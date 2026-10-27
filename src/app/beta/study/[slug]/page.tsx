import type { Metadata } from "next";
import BetaModulePlaceholder from "@/components/beta/BetaModulePlaceholder";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { findBetaModule } from "@/lib/beta/modules";

/**
 * A study module that has not shipped its own route yet. A module ships by adding
 * src/app/beta/study/<slug>/page.tsx, which outranks this dynamic segment.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	return betaMetadata({ title: findBetaModule("study", slug)?.title ?? "Not found" });
}

export default async function BetaStudyModulePage({ params }: Props) {
	await requireBetaPage();
	const { slug } = await params;
	return <BetaModulePlaceholder destination="study" slug={slug} />;
}
