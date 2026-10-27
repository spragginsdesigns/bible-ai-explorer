import type { Metadata } from "next";
import PrayerScreen from "@/components/beta/prayer/PrayerScreen";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/**
 * Prayer & Testimony (LC-17723, docs/beta/prayer.md): the founder's own prayer
 * requests as living entries (dated updates, linked passages, a reminder and
 * the outcome they confirm in their own words) and the testimony timeline
 * they become. Private by default; never a score.
 */
export function generateMetadata(): Promise<Metadata> {
	return betaMetadata({ title: "Prayer & Testimony" });
}

export default async function BetaPrayerPage() {
	await requireBetaPage();
	return <PrayerScreen />;
}
