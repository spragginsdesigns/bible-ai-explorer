import {
	Archive,
	AudioLines,
	BookOpen,
	Brain,
	FolderOpen,
	GraduationCap,
	Headphones,
	House,
	LibraryBig,
	MapPinned,
	MessageCircleQuestion,
	Mic,
	Network,
	Route,
	ShieldCheck,
	Sparkles,
	Sprout,
	Users,
	Workflow,
	type LucideIcon,
} from "lucide-react";
import type { BetaDestinationId, BetaModuleStatus, BetaSectionId } from "@/lib/beta/modules";
import { BETA_STATUS_LABEL } from "@/lib/beta/modules";

/** Icons for the beta's five tabs. */
export const SECTION_ICONS: Record<BetaSectionId, LucideIcon> = {
	home: House,
	bible: BookOpen,
	study: Sparkles,
	library: LibraryBig,
	learn: GraduationCap,
};

/** One icon per module slug; a module without one falls back to its destination's. */
const MODULE_ICONS: Record<string, LucideIcon> = {
	atlas: MapPinned,
	projects: FolderOpen,
	verify: ShieldCheck,
	tutor: MessageCircleQuestion,
	sermons: AudioLines,
	voice: Mic,
	audio: Headphones,
	maps: Workflow,
	rooms: Users,
	vault: Archive,
	graph: Network,
	paths: Route,
	memory: Brain,
	growth: Sprout,
};

export function moduleIcon(slug: string, destination: BetaDestinationId): LucideIcon {
	return MODULE_ICONS[slug] ?? SECTION_ICONS[destination];
}

/**
 * Each destination has one quiet tint, used only on its icon tiles: the color
 * says where a module lives. Gold stays the beta's one accent.
 */
export const DESTINATION_TILE: Record<BetaDestinationId, string> = {
	bible: "bg-amber-500/[.14] text-amber-800 dark:bg-amber-300/[.12] dark:text-amber-200",
	study: "bg-sky-500/[.13] text-sky-800 dark:bg-sky-300/[.12] dark:text-sky-200",
	library: "bg-emerald-500/[.13] text-emerald-800 dark:bg-emerald-300/[.12] dark:text-emerald-200",
	learn: "bg-rose-500/[.12] text-rose-800 dark:bg-rose-300/[.12] dark:text-rose-200",
};

const STATUS_CHIP: Record<BetaModuleStatus, string> = {
	live: "border-transparent bg-[#e5b664] text-[#1c2118]",
	building: "border-amber-700/40 bg-amber-500/10 text-amber-900 dark:border-amber-300/40 dark:text-amber-200",
	planned: "border-black/10 bg-black/[.04] text-neutral-600 dark:border-white/10 dark:bg-white/[.04] dark:text-[#bbb3a7]",
};

export function StatusChip({ status }: { status: BetaModuleStatus }) {
	return (
		<span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_CHIP[status]}`}>
			{BETA_STATUS_LABEL[status]}
		</span>
	);
}

/** The square icon tile cards and headers share. */
export function IconTile({ Icon, tone, size = "md" }: { Icon: LucideIcon; tone: string; size?: "md" | "lg" }) {
	const box = size === "lg" ? "h-16 w-16 rounded-[20px]" : "h-11 w-11 rounded-[14px]";
	return (
		<span className={`flex shrink-0 items-center justify-center ${box} ${tone}`} aria-hidden>
			<Icon size={size === "lg" ? 30 : 22} strokeWidth={1.7} />
		</span>
	);
}
