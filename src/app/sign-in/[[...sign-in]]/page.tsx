import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
	return (
		<div className="min-h-screen flex items-center justify-center gradient-mesh">
			<SignIn
				appearance={{
					elements: {
						rootBox: "mx-auto",
						card: "bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.06] shadow-xl",
					},
				}}
			/>
		</div>
	);
}
