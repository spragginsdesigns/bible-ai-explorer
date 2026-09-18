import BibleAIExplorer from "../components/BibleAIExplorer";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import LandingPage from "@/components/marketing/LandingPage";
import { headers } from "next/headers";
import { detectInstallPlatform } from "@/lib/install-platform";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	alternates: {
		canonical: "/",
		types: { "text/markdown": "/index.md" },
	},
};

export default async function Home() {
	const { userId } = await auth();
	if (userId) return <BibleAIExplorer />;
	const requestHeaders = await headers();
	const installPlatform = detectInstallPlatform(requestHeaders.get("user-agent") ?? "", requestHeaders.get("sec-ch-ua-platform") ?? "");
	return <LandingPage installPlatform={installPlatform} billingOpen={process.env.SUREWORD_BILLING_ENABLED === "true" && process.env.SUREWORD_USAGE_ENABLED === "true" && Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET)} limitsEnabled={process.env.SUREWORD_USAGE_ENABLED === "true"} />;
}
