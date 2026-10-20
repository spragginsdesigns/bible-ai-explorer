import type { Metadata } from "next";
import SectionShell from "@/components/SectionShell";
import StudyScreen from "@/components/daily/StudyScreen";

export const metadata: Metadata = { title: "Study", robots: { index: false } };
export default function StudyPage() { return <SectionShell active="study"><StudyScreen /></SectionShell>; }
