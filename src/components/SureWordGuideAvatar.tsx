"use client";

import Image from "next/image";
import { memo } from "react";

const SureWordGuideAvatar = memo(function SureWordGuideAvatar({
	size = 32,
	active = false,
}: {
	size?: number;
	active?: boolean;
}) {
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
