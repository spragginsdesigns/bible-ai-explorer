#!/usr/bin/env node
/**
 * Builds the SureWord Beta atlas basemap (LC-17655, docs/beta/atlas.md):
 * `src/lib/beta/atlas/basemap.ts`, the land, lakes and rivers of the Bible's
 * world as SVG paths, from Natural Earth (public domain,
 * https://www.naturalearthdata.com/about/terms-of-use/).
 *
 *     node scripts/beta-atlas-basemap.mjs            # downloads v5.1.2
 *     node scripts/beta-atlas-basemap.mjs <dir>      # reads <dir>/ne_10m_*.geojson
 *
 * No tiles and no map provider: the paths ship in the beta's own bundle, so
 * the map costs nothing, works offline and takes SureWord's parchment colours.
 * The projection (equirectangular, x scaled by cos 34°) must match
 * `projectLonLat` in `src/lib/beta/atlas/atlas-rules.ts`; a test checks both.
 *
 * Detail is kept where the map is read closely: inside HOLY_LAND the outline
 * is simplified to FINE_TOLERANCE (about 300 m), everywhere else to
 * COARSE_TOLERANCE (about 2 km), and islands smaller than MIN_ISLAND_DEG2 are
 * dropped (Clauda, the smallest island Acts names, is kept).
 *
 * Modern reservoirs and canals are left out on purpose: Lake Nasser, the
 * Euphrates dams and the Suez canal did not exist when Scripture was written.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(repoRoot, "src/lib/beta/atlas/basemap.ts");
const NE_TAG = "v5.1.2";
const NE_BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson`;

// Keep in step with atlas-rules.ts (BASEMAP_PROJECTION).
const LON_MIN = 8;
const LON_MAX = 52;
const LAT_MIN = 21;
const LAT_MAX = 45;
const UNITS_PER_DEGREE = 500;
const X_SCALE = Math.cos((34 * Math.PI) / 180);

const HOLY_LAND = { lonMin: 33.8, lonMax: 37.2, latMin: 29.2, latMax: 33.9 };
const FINE_TOLERANCE = 0.003;
const COARSE_TOLERANCE = 0.012;
const MIN_ISLAND_DEG2 = 0.0018;
const RIVER_TOLERANCE = 0.006;

const NATURAL_LAKES = new Set([
	"Sea of Galilee",
	"Dead Sea",
	"Lake Van",
	"Lake Urmia",
	"Lake Tuz",
	"Beyşehir",
	"Eğirdir",
	"Great Bitter Lake",
]);
/** Rivers worth drawing for the Bible's geography; every other line is left out. */
const RIVERS = new Set([
	"Nile",
	"Rosetta Branch",
	"Damietta Branch",
	"Jordan",
	"Euphrates",
	"Firat",
	"Al Furat",
	"Tigris",
	"Dicle",
	"Shatt al Arab",
	"Shatt al Hillah",
	"Asi",
	"Orontes",
	"Tevere",
	"Byk Menderes",
	"Strymnas",
]);

async function loadLayer(dir, name) {
	if (dir) return JSON.parse(readFileSync(join(dir, `${name}.geojson`), "utf8"));
	const res = await fetch(`${NE_BASE}/${name}.geojson`);
	if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
	return res.json();
}

const project = ([lon, lat]) => [(lon - LON_MIN) * UNITS_PER_DEGREE * X_SCALE, (LAT_MAX - lat) * UNITS_PER_DEGREE];

/* ------------------------------------------------------------- clipping */

function clipRing(ring) {
	// Sutherland-Hodgman against the map rectangle, in lon/lat.
	const edges = [
		(p) => p[0] >= LON_MIN,
		(p) => p[0] <= LON_MAX,
		(p) => p[1] >= LAT_MIN,
		(p) => p[1] <= LAT_MAX,
	];
	const crossers = [
		(a, b) => lerpAt(a, b, 0, LON_MIN),
		(a, b) => lerpAt(a, b, 0, LON_MAX),
		(a, b) => lerpAt(a, b, 1, LAT_MIN),
		(a, b) => lerpAt(a, b, 1, LAT_MAX),
	];
	let out = ring;
	for (let e = 0; e < 4; e++) {
		const input = out;
		out = [];
		if (input.length === 0) break;
		for (let i = 0; i < input.length; i++) {
			const cur = input[i];
			const prev = input[(i + input.length - 1) % input.length];
			const curIn = edges[e](cur);
			const prevIn = edges[e](prev);
			if (curIn) {
				if (!prevIn) out.push(crossers[e](prev, cur));
				out.push(cur);
			} else if (prevIn) {
				out.push(crossers[e](prev, cur));
			}
		}
	}
	return out;
}

function lerpAt(a, b, axis, value) {
	const t = (value - a[axis]) / (b[axis] - a[axis]);
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipLine(line) {
	// Lines are only kept piecewise inside the rectangle (rivers never need cutting mid-segment here).
	const inside = (p) => p[0] >= LON_MIN && p[0] <= LON_MAX && p[1] >= LAT_MIN && p[1] <= LAT_MAX;
	const runs = [];
	let run = [];
	for (const p of line) {
		if (inside(p)) run.push(p);
		else if (run.length) {
			runs.push(run);
			run = [];
		}
	}
	if (run.length) runs.push(run);
	return runs.filter((r) => r.length > 1);
}

/* ---------------------------------------------------------- simplifying */

const inHolyLand = (minLon, minLat, maxLon, maxLat) =>
	maxLon >= HOLY_LAND.lonMin && minLon <= HOLY_LAND.lonMax && maxLat >= HOLY_LAND.latMin && minLat <= HOLY_LAND.latMax;

function segmentDistance(p, a, b) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len = dx * dx + dy * dy;
	if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas-Peucker whose tolerance tightens wherever the span touches the Holy Land. */
function simplify(points, coarse, fine) {
	if (points.length <= 2) return points.slice();
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack = [[0, points.length - 1]];
	while (stack.length) {
		const [i, j] = stack.pop();
		let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
		let worst = -1;
		let worstDistance = 0;
		for (let k = i; k <= j; k++) {
			const p = points[k];
			if (p[0] < minLon) minLon = p[0];
			if (p[0] > maxLon) maxLon = p[0];
			if (p[1] < minLat) minLat = p[1];
			if (p[1] > maxLat) maxLat = p[1];
			if (k === i || k === j) continue;
			const d = segmentDistance(p, points[i], points[j]);
			if (d > worstDistance) {
				worstDistance = d;
				worst = k;
			}
		}
		const tolerance = inHolyLand(minLon, minLat, maxLon, maxLat) ? fine : coarse;
		if (worst !== -1 && worstDistance > tolerance) {
			keep[worst] = 1;
			stack.push([i, worst], [worst, j]);
		}
	}
	return points.filter((_, index) => keep[index]);
}

function ringArea(ring) {
	let sum = 0;
	for (let i = 0; i < ring.length; i++) {
		const [x1, y1] = ring[i];
		const [x2, y2] = ring[(i + 1) % ring.length];
		sum += x1 * y2 - x2 * y1;
	}
	return Math.abs(sum / 2);
}

/* ------------------------------------------------------------ paths out */

/** Relative SVG path for projected points: small numbers, short strings. */
function toPath(rings, closed) {
	let d = "";
	for (const ring of rings) {
		const pts = ring.map(project).map(([x, y]) => [Math.round(x), Math.round(y)]);
		const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
		if (dedup.length < (closed ? 3 : 2)) continue;
		d += `M${dedup[0][0]} ${dedup[0][1]}`;
		let l = "l";
		for (let i = 1; i < dedup.length; i++) {
			const dx = dedup[i][0] - dedup[i - 1][0];
			const dy = dedup[i][1] - dedup[i - 1][1];
			l += `${i > 1 && dx >= 0 ? " " : ""}${dx}${dy >= 0 ? " " : ""}${dy}`;
		}
		d += l + (closed ? "z" : "");
	}
	return d;
}

function polygonRings(geometry) {
	if (!geometry) return [];
	if (geometry.type === "Polygon") return geometry.coordinates;
	if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
	return [];
}

function lineStrings(geometry) {
	if (!geometry) return [];
	if (geometry.type === "LineString") return [geometry.coordinates];
	if (geometry.type === "MultiLineString") return geometry.coordinates;
	return [];
}

function areaPaths(features, keepFeature) {
	const rings = [];
	for (const feature of features) {
		if (!keepFeature(feature)) continue;
		for (const ring of polygonRings(feature.geometry)) {
			const clipped = clipRing(ring);
			if (clipped.length < 3 || ringArea(clipped) < MIN_ISLAND_DEG2) continue;
			const simple = simplify(clipped, COARSE_TOLERANCE, FINE_TOLERANCE);
			if (simple.length >= 3) rings.push(simple);
		}
	}
	return { path: toPath(rings, true), rings: rings.length, points: rings.reduce((n, r) => n + r.length, 0) };
}

async function main() {
	const dir = process.argv[2] && existsSync(process.argv[2]) ? process.argv[2] : null;
	const [land, lakes, rivers] = await Promise.all([
		loadLayer(dir, "ne_10m_land"),
		loadLayer(dir, "ne_10m_lakes"),
		loadLayer(dir, "ne_10m_rivers_lake_centerlines"),
	]);

	const landOut = areaPaths(land.features, () => true);
	const lakeOut = areaPaths(
		lakes.features,
		(f) => NATURAL_LAKES.has(f.properties?.name) && f.properties?.featurecla !== "Reservoir"
	);
	const riverLines = [];
	for (const feature of rivers.features) {
		if (!RIVERS.has(feature.properties?.name)) continue;
		// A centerline through a natural lake would draw the river across the water;
		// through a modern reservoir it is where the ancient river ran, so it stays.
		if (feature.properties?.featurecla === "Lake Centerline" && feature.properties?.name === "Jordan") continue;
		for (const line of lineStrings(feature.geometry)) {
			for (const run of clipLine(line)) riverLines.push(simplify(run, RIVER_TOLERANCE, RIVER_TOLERANCE / 2));
		}
	}
	const riverPath = toPath(riverLines, false);

	const width = Math.round((LON_MAX - LON_MIN) * UNITS_PER_DEGREE * X_SCALE);
	const height = Math.round((LAT_MAX - LAT_MIN) * UNITS_PER_DEGREE);
	const source = `/**
 * GENERATED by scripts/beta-atlas-basemap.mjs - do not edit by hand.
 *
 * The SureWord Beta atlas basemap (LC-17655): land, natural lakes and the
 * Bible's rivers between ${LON_MIN}°E-${LON_MAX}°E and ${LAT_MIN}°N-${LAT_MAX}°N, from Natural Earth
 * ${NE_TAG} 1:10m (public domain; "Made with Natural Earth"). Modern shorelines,
 * equirectangular, ${UNITS_PER_DEGREE} units per degree of latitude, x scaled by cos 34°.
 * Land ${landOut.rings} rings / ${landOut.points} points; lakes ${lakeOut.rings} rings; rivers ${riverLines.length} lines.
 */
export const BASEMAP = {
	width: ${width},
	height: ${height},
	land: ${JSON.stringify(landOut.path)},
	lakes: ${JSON.stringify(lakeOut.path)},
	rivers: ${JSON.stringify(riverPath)},
} as const;
`;
	writeFileSync(OUT, source);
	console.log(
		`basemap: land ${landOut.rings} rings/${landOut.points} pts, lakes ${lakeOut.rings}, rivers ${riverLines.length} -> ${(source.length / 1024).toFixed(1)} KB`
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
