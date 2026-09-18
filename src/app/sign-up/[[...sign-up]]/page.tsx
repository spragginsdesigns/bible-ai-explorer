import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";

// A bare auth form has nothing worth ranking; keep it out of the index but let
// crawlers follow its links back to the landing page.
export const metadata: Metadata = {
	title: "Create your account",
	robots: { index: false, follow: true },
};

export default function SignUpPage() {
	return (
		<div className="min-h-screen flex items-center justify-center gradient-mesh">
			<SignUp
				appearance={{
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
