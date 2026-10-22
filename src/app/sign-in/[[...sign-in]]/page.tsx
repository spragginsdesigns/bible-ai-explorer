import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

import SignInAnalytics from "@/components/analytics/SignInAnalytics";

// A bare auth form has nothing worth ranking; keep it out of the index but let
// crawlers follow its links back to the landing page.
export const metadata: Metadata = {
	title: "Sign in",
	robots: { index: false, follow: true },
};

export default function SignInPage() {
	return (
		<div className="min-h-screen flex items-center justify-center gradient-mesh">
			<SignInAnalytics />
			{/* withSignUp: an email with no account yet carries on into creating
			    one instead of stopping at "Couldn't find your account", the dead
			    end closed testers hit on Android before 1.99.0. Google sits under
			    the email form, the same order as every native client. */}
			<SignIn
				withSignUp
				appearance={{
					options: { socialButtonsPlacement: "bottom" },
					variables: {
						fontFamily: "var(--font-body), system-ui, sans-serif",
					},
					elements: {
						rootBox: "mx-auto",
						card: "bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.06] shadow-xl",
					},
				}}
			/>
		</div>
	);
}
