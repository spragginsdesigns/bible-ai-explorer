import type { Metadata } from "next";
import BetaDestinationScreen from "@/components/beta/BetaDestinationScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Library" });
}

export default async function BetaLibraryPage() {
	await requireBetaPage();
	return <BetaDestinationScreen destination="library" />;
}
