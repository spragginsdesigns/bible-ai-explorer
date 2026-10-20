import type { Metadata } from "next";
import SectionShell from "@/components/SectionShell";
import TodayScreen from "@/components/daily/TodayScreen";

export const metadata: Metadata = { title: "Today", robots: { index: false } };
export default function TodayPage() { return <SectionShell active="today"><TodayScreen /></SectionShell>; }
