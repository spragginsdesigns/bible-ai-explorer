/**
 * Each path's banner (LC-17648): a quiet painted landscape with a road through
 * it, after the founders' concept board, drawn as a static SVG so it costs no
 * image request, no blur and no animation. Personal curricula get a palette
 * picked from their topic.
 */

interface Palette {
	sky: [string, string];
	sun: string;
	hills: [string, string, string];
	road: string;
	mark: "arch" | "lamp" | "sail" | "cross" | "star";
}

const PALETTES: Record<string, Palette> = {
	foundations: { sky: ["#f2c48c", "#fbe9cc"], sun: "#fff4d6", hills: ["#9db07f", "#6f8f5c", "#46663f"], road: "#f6e2b8", mark: "cross" },
	romans: { sky: ["#e7a77b", "#f8dcc0"], sun: "#ffeccf", hills: ["#c08a62", "#94613f", "#5f3c27"], road: "#f3d7b2", mark: "arch" },
	"reading-scripture": { sky: ["#2e3659", "#d39a62"], sun: "#ffe2a6", hills: ["#525a7d", "#363e60", "#222842"], road: "#e8c48a", mark: "lamp" },
	"life-of-paul": { sky: ["#8fbcd6", "#eef2ec"], sun: "#fff8e6", hills: ["#9bb08c", "#4f88a6", "#2f6382"], road: "#e9e2cf", mark: "sail" },
	// SureWord Academy's courses (LC-17660).
	"ot-survey": { sky: ["#d9a36a", "#f6e3c4"], sun: "#fff1d2", hills: ["#b39a6b", "#8a7148", "#5b4a2e"], road: "#f1dcb4", mark: "arch" },
	"nt-survey": { sky: ["#9fb7d9", "#f3ecdf"], sun: "#fff7e4", hills: ["#94ad86", "#64886a", "#3e5f4a"], road: "#efe3c8", mark: "cross" },
	doctrines: { sky: ["#3b3f63", "#c99a6a"], sun: "#ffe4ad", hills: ["#5b5f86", "#3d4166", "#262a47"], road: "#e6c592", mark: "star" },
};

const PERSONAL: Palette[] = [
	{ sky: ["#c9b6e4", "#f4ead9"], sun: "#fff6e2", hills: ["#a7a3c9", "#7a7aa6", "#4f5179"], road: "#f1e3c6", mark: "star" },
	{ sky: ["#a9cdb8", "#f4eedc"], sun: "#fff8e3", hills: ["#8fb39a", "#5f8e6f", "#3b6149"], road: "#efe2c3", mark: "star" },
	{ sky: ["#e6b7a4", "#f8ead8"], sun: "#fff3df", hills: ["#c39784", "#9a6d5c", "#6b4639"], road: "#f2dfc2", mark: "star" },
];

function hash(text: string): number {
	let value = 7;
	for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
	return value;
}

function paletteFor(pathId: string): Palette {
	return PALETTES[pathId] ?? PERSONAL[hash(pathId) % PERSONAL.length];
}

function Mark({ kind, color }: { kind: Palette["mark"]; color: string }) {
	if (kind === "arch")
		return (
			<g fill={color} opacity=".55">
				<rect x="452" y="96" width="70" height="8" />
				<path d="M458 104h58v58h-14v-30a15 15 0 0 0-30 0v30h-14z" />
			</g>
		);
	if (kind === "lamp")
		return (
			<g fill={color} opacity=".85">
				<circle cx="470" cy="58" r="3" />
				<circle cx="520" cy="40" r="2" />
				<circle cx="420" cy="34" r="2" />
				<circle cx="560" cy="70" r="1.6" />
			</g>
		);
	if (kind === "sail")
		return (
			<g fill={color} opacity=".7">
				<path d="M470 150h44l-6 8h-32z" />
				<path d="M492 112v36h-18z" />
				<path d="M494 116v32h14z" opacity=".8" />
			</g>
		);
	if (kind === "cross")
		return (
			<g fill={color} opacity=".45">
				<rect x="486" y="104" width="4" height="34" />
				<rect x="476" y="112" width="24" height="4" />
			</g>
		);
	return (
		<g fill={color} opacity=".8">
			<path d="M500 44l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />
		</g>
	);
}

export default function PathArt({ pathId, className = "" }: { pathId: string; className?: string }) {
	const palette = paletteFor(pathId);
	const id = `path-art-${pathId.replace(/[^a-z0-9-]/gi, "")}`;
	return (
		<svg viewBox="0 0 640 260" preserveAspectRatio="xMidYMid slice" aria-hidden className={className}>
			<defs>
				<linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor={palette.sky[0]} />
					<stop offset="1" stopColor={palette.sky[1]} />
				</linearGradient>
			</defs>
			<rect width="640" height="260" fill={`url(#${id}-sky)`} />
			<circle cx="470" cy="118" r="46" fill={palette.sun} opacity=".9" />
			<Mark kind={palette.mark} color={palette.mark === "lamp" || palette.mark === "star" ? palette.sun : palette.hills[2]} />
			<path d="M0 150 C90 118 170 128 250 140 S420 120 520 138 S610 132 640 128 V260 H0z" fill={palette.hills[0]} />
			<path d="M0 182 C110 150 210 170 300 168 S470 150 560 170 S620 172 640 166 V260 H0z" fill={palette.hills[1]} />
			<path d="M0 214 C120 190 220 206 330 200 S520 188 640 204 V260 H0z" fill={palette.hills[2]} />
			<path d="M300 260 C318 236 352 222 380 210 S430 186 452 170 S468 156 474 150" fill="none" stroke={palette.road} strokeWidth="10" strokeLinecap="round" opacity=".85" />
		</svg>
	);
}
