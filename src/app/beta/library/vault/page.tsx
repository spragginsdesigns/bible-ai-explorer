import { Suspense } from "react";
import type { Metadata } from "next";
import VaultScreen from "@/components/beta/vault/VaultScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/**
 * The Knowledge Vault (LC-17645, docs/beta/vault.md): everything the founder
 * has studied in SureWord, read in place, searchable by words and meaning,
 * askable, and seen over time. This static route replaces the module's
 * placeholder under /beta/library/[slug].
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Knowledge Vault" });
}

export default async function BetaVaultPage() {
	await requireBetaPage();
	return (
		<Suspense>
			<VaultScreen />
		</Suspense>
	);
}
