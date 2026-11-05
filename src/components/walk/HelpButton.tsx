"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { HELP_SCREENS, type HelpScreen } from "@/lib/onboarding-rules";
import { primarySectionForPath } from "@/lib/primary-navigation";
import HelpDialog from "./HelpDialog";

const LABELS: Record<HelpScreen, string> = {
	today: "Help with Today",
	bible: "Help with the Bible reader",
	chat: "Help with Chat",
	study: "Help with Study",
	connections: "Help with Connections",
};

/**
 * The "?" in a main screen's header (docs/onboarding/PLAN.md): opens a short
 * sheet about the screen it was on; "Ask SureWord about this" then opens Chat
 * with that screen's help sentence, so the answer can come with a glowing
 * "Show me". Renders nothing off the five main screens.
 */
export default function HelpButton() {
	const pathname = usePathname();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const section = primarySectionForPath(pathname);
	if (!section || !Object.prototype.hasOwnProperty.call(HELP_SCREENS, section)) return null;
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={LABELS[section]}
				title="Help"
				className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-black/[0.05] hover:text-amber-800 dark:text-[#bbb3a7] dark:hover:bg-white/[0.06] dark:hover:text-[#e5b664]"
			>
				<CircleHelp size={24} strokeWidth={1.8} aria-hidden />
			</button>
			{open && <HelpDialog screen={section} onClose={() => setOpen(false)} onAsk={() => { setOpen(false); router.push(`/?help=${section}`); }} />}
		</>
	);
}
