import { Suspense } from "react";
import type { Metadata } from "next";
import SectionShell from "@/components/SectionShell";
import ConnectionsScreen from "@/components/connections/ConnectionsScreen";

export const metadata: Metadata = { title: "Connections", robots: { index: false } };
export default function ConnectionsPage() { return <SectionShell active="connections"><Suspense fallback={<p role="status" className="p-8">Opening Connections...</p>}><ConnectionsScreen /></Suspense></SectionShell>; }
