import type { Metadata } from "next";
import AcademyHub from "@/components/beta/academy/AcademyHub";
import { academyHub } from "@/lib/beta/academy/academy";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/** SureWord Academy (LC-17660, docs/beta/academy.md): Bible courses on Learning Paths. */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "SureWord Academy" });
}

export default async function AcademyPage() {
	const userId = await requireBetaPage();
	const view = await academyHub(userId);
	return <AcademyHub courses={view.courses} records={view.records} />;
}
