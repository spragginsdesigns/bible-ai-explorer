"use client";

/**
 * Last-resort screen for errors in the root layout itself (providers, splash).
 * It replaces the whole document, so it carries its own html/body and inline
 * styles rather than depending on globals.css having loaded.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<html lang="en">
			<body
				style={{
					margin: 0,
					minHeight: "100vh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "#0a0a0a",
					color: "#e5e5e5",
					fontFamily: "system-ui, sans-serif",
					padding: "0 16px",
				}}
			>
				<div style={{ textAlign: "center", maxWidth: 360 }}>
					<h1 style={{ fontSize: 24, marginBottom: 8 }}>SureWord hit a problem</h1>
					<p style={{ color: "#a3a3a3", marginBottom: 24 }}>
						Your conversations and notes are safe. Try loading the app again.
					</p>
					<button
						type="button"
						onClick={reset}
						style={{
							background: "#f59e0b",
							color: "#0a0a0a",
							border: 0,
							borderRadius: 6,
							padding: "8px 16px",
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						Try again
					</button>
				</div>
			</body>
		</html>
	);
}
