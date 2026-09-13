import BibleAIExplorer from "../components/BibleAIExplorer";
import { auth } from "@clerk/nextjs/server";
import LandingPage from "@/components/marketing/LandingPage";

export const dynamic = "force-dynamic";

export default async function Home() {
	const { userId } = await auth();
	if (userId) return <BibleAIExplorer />;
	return <LandingPage billingOpen={process.env.SUREWORD_BILLING_ENABLED === "true" && process.env.SUREWORD_USAGE_ENABLED === "true" && Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET)} limitsEnabled={process.env.SUREWORD_USAGE_ENABLED === "true"} />;
}
