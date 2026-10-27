import type { Metadata } from "next";
import BetaDestinationScreen from "@/components/beta/BetaDestinationScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Together" });
}

export default async function BetaTogetherPage() {
	await requireBetaPage();
	return <BetaDestinationScreen destination="together" />;
}
