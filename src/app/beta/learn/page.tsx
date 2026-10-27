import type { Metadata } from "next";
import BetaDestinationScreen from "@/components/beta/BetaDestinationScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Learn" });
}

export default async function BetaLearnPage() {
	await requireBetaPage();
	return <BetaDestinationScreen destination="learn" />;
}
