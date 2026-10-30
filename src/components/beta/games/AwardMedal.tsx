import {
	Apple,
	Bed,
	Bird,
	Coins,
	Crown,
	DoorClosed,
	Droplets,
	Egg,
	Eye,
	Feather,
	Fish,
	Flame,
	Gem,
	Grape,
	Hand,
	Heart,
	House,
	Key,
	Leaf,
	Moon,
	Mountain,
	Sailboat,
	Scroll,
	Search,
	Shirt,
	ShoppingBasket,
	Sparkles,
	Sprout,
	Sun,
	Wheat,
	Wind,
	Wine,
	Zap,
	type LucideIcon,
} from "lucide-react";
import type { GameEmblem, GameGrade } from "@/lib/beta/games/games-rules";

/** A chapter game's award (LC-17850): a medal in the grade's metal, on a ribbon, with its chapter's mark (LC-17851). */
const METAL: Record<GameGrade, { face: string; rim: string; shine: string }> = {
	gold: { face: "#e5b664", rim: "#9a6b1f", shine: "#fff1c9" },
	silver: { face: "#cfd3d8", rim: "#7c838c", shine: "#ffffff" },
	bronze: { face: "#c48a58", rim: "#7a4a24", shine: "#f3cfa8" },
};

const ICONS: Partial<Record<GameEmblem, LucideIcon>> = {
	scroll: Scroll,
	wheat: Wheat,
	fish: Fish,
	flame: Flame,
	gem: Gem,
	house: House,
	sailboat: Sailboat,
	hand: Hand,
	bird: Bird,
	feather: Feather,
	apple: Apple,
	sprout: Sprout,
	basket: ShoppingBasket,
	key: Key,
	coins: Coins,
	search: Search,
	sparkles: Sparkles,
	eye: Eye,
	leaf: Leaf,
	shirt: Shirt,
	egg: Egg,
	zap: Zap,
	crown: Crown,
	moon: Moon,
	heart: Heart,
	sun: Sun,
	droplets: Droplets,
	door: DoorClosed,
	bed: Bed,
	wind: Wind,
	mountain: Mountain,
	grape: Grape,
	wine: Wine,
};

export default function AwardMedal({ grade, emblem = "wave", size = 72, title }: { grade: GameGrade; emblem?: GameEmblem; size?: number; title?: string }) {
	const metal = METAL[grade];
	const Icon = ICONS[emblem];
	return (
		<svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="shrink-0">
			<path d="M20 2h10l6 22h-10z" fill="#3d5a73" />
			<path d="M34 2h10l-6 22h-10z" fill="#24425a" />
			<circle cx="32" cy="40" r="20" fill={metal.rim} />
			<circle cx="32" cy="40" r="16.5" fill={metal.face} />
			<path d="M24 33a11 11 0 0 1 9-6" stroke={metal.shine} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".85" />
			{Icon ? (
				<Icon x={23} y={31} width={18} height={18} color={metal.rim} strokeWidth={2.4} aria-hidden />
			) : emblem === "star" ? (
				// The star that went before them and stood over where the young child was.
				<path d="M32 28l2.6 7.4 7.4 2.6-7.4 2.6L32 48l-2.6-7.4-7.4-2.6 7.4-2.6z" fill={metal.rim} />
			) : (
				<>
					{/* A wave beneath a footstep: walked on the water. */}
					<path d="M22 46c3-3 6-3 9 0s6 3 9 0" stroke={metal.rim} strokeWidth="2.4" strokeLinecap="round" fill="none" />
					<path d="M29 41c0-4 2.4-7 4.6-7 1.6 0 2 1.6 1.2 3.4l-1.6 3.6z" fill={metal.rim} />
				</>
			)}
		</svg>
	);
}
