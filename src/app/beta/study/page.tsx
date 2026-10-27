import type { Metadata } from "next";
import BetaDestinationScreen from "@/components/beta/BetaDestinationScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Study" });
}

export default async function BetaStudyPage() {
	await requireBetaPage();
	return <BetaDestinationScreen destination="study" />;
}
