import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("the shared Swift timeline decoder matches the API eras key", async () => {
	const [route, types] = await Promise.all([
		read("src/app/api/bible/atlas/timeline/route.ts"),
		read("macos/Shared/Atlas/AtlasTypes.swift"),
	]);

	assert.match(route, /\.\.\.timeline/);
	assert.match(types, /case groups = "eras"/);
});

test("Apple Study owns atlas discovery and both readers retain contextual entry points", async () => {
	const [studyHome, macStudy, macReader, iosStudy, iosReader] = await Promise.all([
		read("macos/Shared/DailyCross/DailyWalkHome.swift"),
		read("macos/SureWord/App/DailyWalkSections.swift"),
		read("macos/SureWord/Bible/Views/ChapterReaderPane.swift"),
		read("macos/SureWord-iOS/Views/DailyWalkSections.swift"),
		read("macos/SureWord-iOS/Views/Bible/ChapterReaderView.swift"),
	]);

	for (const title of ["Bible timeline", "People of the Bible", "Places & atlas"]) {
		assert.ok(studyHome.includes(`title: "${title}"`));
	}
	assert.match(macStudy, /StudyHome/);
	assert.match(iosStudy, /StudyHome/);
	assert.match(macReader, /Who's in this chapter/);
	assert.match(iosReader, /Who's in this chapter/);
});

test("native entity details preserve typed and legacy connections", async () => {
	const [macExplorer, iosExplorer] = await Promise.all([
		read("macos/SureWord/Bible/Views/AtlasExplorerPane.swift"),
		read("macos/SureWord-iOS/Views/Bible/AtlasExplorerView.swift"),
	]);

	for (const source of [macExplorer, iosExplorer]) {
		assert.match(source, /relationDetails/);
		assert.match(source, /legacyConnections/);
		assert.match(source, /traceConnection/);
		assert.match(source, /personID:/);
	}
	assert.match(iosExplorer, /onAppear \{ model\.loadEntity\(entityID\) \}/);
	assert.match(iosExplorer, /onAppear \{ model\.loadEvent\(eventID\) \}/);
});
