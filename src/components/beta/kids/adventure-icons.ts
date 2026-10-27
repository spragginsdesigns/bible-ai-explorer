import { Baby, CloudLightning, Fish, Moon, Shield, Ship, Shirt, Sparkles, Sun, Sunrise, Waves, Wheat, BookOpen, type LucideIcon } from "lucide-react";

/** One quiet icon per adventure; an adventure added later without one gets the open book. */
const ICONS: Record<string, LucideIcon> = {
	creation: Sun,
	noah: Ship,
	abraham: Sparkles,
	joseph: Shirt,
	"red-sea": Waves,
	david: Shield,
	daniel: Moon,
	jonah: Fish,
	"birth-of-jesus": Baby,
	"calming-the-storm": CloudLightning,
	"five-loaves": Wheat,
	resurrection: Sunrise,
};

export function adventureIcon(id: string): LucideIcon {
	return ICONS[id] ?? BookOpen;
}
