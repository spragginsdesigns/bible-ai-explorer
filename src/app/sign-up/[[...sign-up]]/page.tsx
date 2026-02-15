import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
	return (
		<div className="min-h-screen flex items-center justify-center gradient-mesh">
			<SignUp
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
