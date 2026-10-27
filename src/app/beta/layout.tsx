import type { Metadata } from "next";
import BetaShell from "@/components/beta/BetaShell";
import { betaMetadata, requireBetaPage } from "@/lib/beta/access";

/**
 * SureWord Beta (LC-17631, docs/beta/README.md): a founders-only preview of
 * the study platform, on the web only for now.
 *
 * Only BETA_USER_IDS may open anything under /beta. Every other signed-in
 * account gets the ordinary 404; signed-out visitors are sent to /sign-in by
 * the middleware, the same as for any path that does not exist. Every page
 * below also calls requireBetaPage() itself, because Next renders a layout and
 * its page concurrently and a page must not read data for someone the layout
 * is about to turn away (tests/beta-access.test.mjs checks both).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
	return betaMetadata({
		// absolute: the root layout's "%s | SureWord" must not wrap the beta's own name.
		title: { absolute: "SureWord Beta", template: "%s | SureWord Beta" },
		robots: { index: false, follow: false, nocache: true },
	});
}

export default async function BetaLayout({ children }: { children: React.ReactNode }) {
	await requireBetaPage();
	return <BetaShell>{children}</BetaShell>;
}
