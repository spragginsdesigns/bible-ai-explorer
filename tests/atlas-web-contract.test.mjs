import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { atlasDateLabel } from "../src/components/atlas/atlasView.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const screen = read("../src/components/atlas/AtlasScreen.tsx");
const hooks = read("../src/components/atlas/useAtlas.ts");

test("the web explorer exposes all three browse modes and stable detail links", () => {
	assert.match(screen, /\["timeline", "people", "places"\]/);
	assert.match(screen, /detail: `\$\{selection\.kind\}:\$\{selection\.id\}`/);
	assert.match(screen, /router\.push\(destination, \{ scroll: false \}\)/);
	assert.match(screen, /mode === "timeline" \? null/);
	assert.match(hooks, /\/api\/bible\/atlas\/event\?id=/);
});

test("small-screen details follow the modal keyboard contract", () => {
	assert.match(screen, /role="dialog"/);
	assert.match(screen, /aria-modal="true"/);
	assert.match(screen, /event\.key === "Escape"/);
	assert.match(screen, /event\.key !== "Tab"/);
	assert.match(screen, /prior\?\.focus\(\)/);
	assert.match(screen, /<aside[\s\S]*hidden min-w-0 lg:block/);
});

test("person details continue into journeys, cited relations and connection tracing", () => {
	assert.match(screen, /entity\.relationDetails/);
	assert.match(screen, /Other recorded connections/);
	assert.match(screen, /entity\.events\.slice\(0, 5\)/);
	assert.match(screen, /personId: id/);
	assert.match(screen, /placeholder="Search any person"/);
	assert.match(hooks, /\/api\/bible\/atlas\/connection\?from=/);
	assert.match(screen, /connection\.path\.relations\[index\]\.refs/);
});

test("invalid chapter URLs fail closed instead of opening the whole timeline", () => {
	assert.match(screen, /invalidChapterScope/);
	assert.match(screen, /chapter > scopedBook\.chapters/);
	assert.match(screen, /That is not a chapter of the Bible/);
});

test("date presentation never labels an undated event as Ussher chronology", () => {
	assert.equal(
		atlasDateLabel({ label: "date not given", provenance: "undated" }),
		"Date not given",
	);
	assert.equal(atlasDateLabel(undefined, "date not given"), "Date not given");
	assert.equal(
		atlasDateLabel({
			label: "c. 2348 BC",
			startYear: -2348,
			endYear: -2348,
			provenance: "traditional-ussher",
		}),
		"Traditional chronology · c. 2348 BC",
	);
});
