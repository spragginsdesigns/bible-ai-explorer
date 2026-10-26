"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { HELP_SCREENS, type HelpScreen } from "@/lib/onboarding-rules";
import { primarySectionForPath } from "@/lib/primary-navigation";

const LABELS: Record<HelpScreen, string> = {
	today: "Help with Today",
	bible: "Help with the Bible reader",
	chat: "Help with Chat",
	study: "Help with Study",
	connections: "Help with Connections",
};

/**
 * The "?" in a main screen's header (docs/onboarding/PLAN.md): opens Chat and
 * asks SureWord about the screen it was on, so the answer can come with a
 * glowing "Show me". Renders nothing off the five main screens.
 */
export default function HelpButton() {
	const pathname = usePathname();
	const section = primarySectionForPath(pathname);
	if (!section || !Object.prototype.hasOwnProperty.call(HELP_SCREENS, section)) return null;
	return (
		<Link
			href={`/?help=${section}`}
			aria-label={LABELS[section]}
			title="Help"
			className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-black/[0.05] hover:text-amber-800 dark:text-[#bbb3a7] dark:hover:bg-white/[0.06] dark:hover:text-[#e5b664]"
		>
			<CircleHelp size={24} strokeWidth={1.8} aria-hidden />
		</Link>
	);
}
