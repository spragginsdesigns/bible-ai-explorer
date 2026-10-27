import Image from "next/image";
import type { CoverId } from "@/lib/beta/projects/projects-rules";

/**
 * A project's cover: one of SureWord's own pieces of art or a plain plate,
 * always under the same dark scrim so the white title reads on every one.
 * Nothing is generated: the art already ships in /public.
 */
type Cover = { label: string } & ({ kind: "image"; src: string; position: string } | { kind: "plate"; className: string });

export const COVERS: Record<CoverId, Cover> = {
	dawn: { label: "Dawn", kind: "image", src: "/daily-walk-dawn.jpg", position: "object-[65%_52%]" },
	"olive-path": { label: "Olive path", kind: "image", src: "/splash/sureword-dawn.webp", position: "object-[50%_76%]" },
	heavens: { label: "Heavens", kind: "image", src: "/splash/sureword-dawn.webp", position: "object-[50%_24%]" },
	sanctuary: { label: "Sanctuary", kind: "image", src: "/chat-home/sureword-sanctuary.png", position: "object-center" },
	parchment: { label: "Vellum", kind: "image", src: "/textures/parchment-dark.webp", position: "object-center" },
	olive: { label: "Olive", kind: "plate", className: "bg-[linear-gradient(160deg,#55623a_0%,#2a331d_60%,#1a2012_100%)]" },
	dusk: { label: "Dusk", kind: "plate", className: "bg-[linear-gradient(160deg,#5b4a6b_0%,#2c2438_60%,#17131f_100%)]" },
};

export const COVER_ORDER = Object.keys(COVERS) as CoverId[];

/** The cover art alone; place it inside a `relative` box with a size. */
export function CoverArt({ cover, sizes, priority = false }: { cover: CoverId; sizes: string; priority?: boolean }) {
	const entry = COVERS[cover] ?? COVERS.parchment;
	return (
		<>
			{entry.kind === "image" ? (
				<Image src={entry.src} alt="" fill sizes={sizes} priority={priority} className={`object-cover ${entry.position}`} />
			) : (
				<span aria-hidden className={`absolute inset-0 ${entry.className}`} />
			)}
			<span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
		</>
	);
}
