import type { Metadata } from "next";
import ServeScreen from "@/components/serve/ServeScreen";

export const metadata: Metadata = { title: "Ways to Serve", robots: { index: false } };

export default function ServePage() {
	return <ServeScreen />;
}
