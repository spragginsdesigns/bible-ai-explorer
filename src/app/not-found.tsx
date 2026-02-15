export const dynamic = "force-dynamic";

export default function NotFound() {
	return (
		<div className="min-h-screen flex items-center justify-center gradient-mesh">
			<div className="text-center">
				<h1 className="text-4xl font-bold text-neutral-200 mb-2">404</h1>
				<p className="text-neutral-500 mb-4">Page not found</p>
				<a
					href="/"
					className="text-amber-400 hover:text-amber-300 transition-colors underline"
				>
					Return to VerseMind
				</a>
			</div>
		</div>
	);
}
