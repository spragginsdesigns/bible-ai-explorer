import type { Metadata } from "next";
import ScriptureCheck from "@/components/beta/verify/ScriptureCheck";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/** Scripture Check (LC-17649, docs/beta/verify.md): check any teaching's quotations and references against the KJV. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Scripture Check" });
}

export default async function ScriptureCheckPage() {
	await requireBetaPage();
	return <ScriptureCheck />;
}
