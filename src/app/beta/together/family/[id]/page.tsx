import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FamilyScreen from "@/components/beta/family/FamilyScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { getFamilyView } from "@/lib/beta/family/family";

/**
 * One family, for its parents (docs/beta/family.md). A family you are not in
 * is the same 404 as a family that does not exist.
 */
type Props = { params: Promise<{ id: string }> };

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Family" });
}

export default async function BetaFamilyScreenPage({ params }: Props) {
	const userId = await requireBetaPage();
	const family = await getFamilyView(userId, (await params).id);
	if (!family) notFound();
	return <FamilyScreen initialFamily={family} />;
}
