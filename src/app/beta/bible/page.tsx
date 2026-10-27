import type { Metadata } from "next";
import BetaDestinationScreen from "@/components/beta/BetaDestinationScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Bible" });
}

export default async function BetaBiblePage() {
	await requireBetaPage();
	return <BetaDestinationScreen destination="bible" />;
}
