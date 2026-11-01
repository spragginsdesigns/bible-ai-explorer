import type { Metadata } from "next";
import FamilyHome from "@/components/beta/family/FamilyHome";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";
import { listRooms } from "@/lib/beta/rooms/rooms";
import { FAMILY_PURPOSE } from "@/lib/beta/family/family";

/** SureWord Family (LC-17658, docs/beta/family.md): the families you are a parent in, and a new one. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Family" });
}

export default async function BetaFamilyPage() {
	const userId = await requireBetaPage();
	return <FamilyHome initialFamilies={await listRooms(userId, FAMILY_PURPOSE)} />;
}
