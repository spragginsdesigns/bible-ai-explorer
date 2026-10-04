"use client";

import Image from "next/image";
import { memo } from "react";

const SureWordGuideAvatar = memo(function SureWordGuideAvatar({
	size = 32,
	active = false,
	variant = "message",
}: {
	size?: number;
	active?: boolean;
	/** "hero" is the welcome-screen form, as on Android: no frame, a soft
	 *  accent glow behind it, and a slow breath that stops under reduced motion. */
	variant?: "message" | "hero";
}) {
	if (variant === "hero") {
		return (
			<span
				role="img"
				aria-label="SureWord AI guide, a golden day star held by folded pages"
				className="relative inline-flex flex-shrink-0 items-center justify-center"
				style={{ width: size, height: size }}
			>
				<span
					aria-hidden
					className="absolute rounded-full bg-amber-500/15 blur-xl motion-safe:animate-pulse dark:bg-amber-400/15"
					style={{ width: size * 0.58, height: size * 0.58 }}
				/>
				<Image
					src="/sureword-guide.png"
					alt=""
					width={size}
					height={size}
					priority
					className="relative object-contain"
					style={{ width: size, height: size }}
				/>
			</span>
		);
	}
	return (
		<span
			role="img"
			aria-label="SureWord AI assistant"
			className="relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber-500/20 bg-black/[0.04] dark:bg-white/[0.04]"
			style={{ width: size, height: size }}
		>
			<Image
				src="/sureword-guide.png"
				alt=""
				width={size}
				height={size}
				className={`object-contain p-[2px] ${active ? "motion-safe:animate-pulse" : ""}`}
			/>
		</span>
	);
});

export default SureWordGuideAvatar;
