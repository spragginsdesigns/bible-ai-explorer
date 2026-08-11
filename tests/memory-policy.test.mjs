import assert from "node:assert/strict";
import test from "node:test";

import { allowsMemoryUse } from "../src/lib/memory-policy.ts";
import { groupMemoriesByCategory } from "../src/lib/memories.ts";

test("memory is used only when the persisted preference is explicitly enabled", () => {
	assert.equal(allowsMemoryUse(true), true);
	assert.equal(allowsMemoryUse(false), false);
	assert.equal(allowsMemoryUse(null), false);
	assert.equal(allowsMemoryUse(undefined), false);
});

test("web memory grouping keeps unknown categories visible under General", () => {
	const memories = [
		{ id: "1", content: "one", category: "profile", updatedAt: "2026-08-11T00:00:00Z" },
		{ id: "2", content: "two", category: "future-category", updatedAt: "2026-08-11T00:00:00Z" },
		{ id: "3", content: "three", category: "general", updatedAt: "2026-08-11T00:00:00Z" },
	];
	const groups = groupMemoriesByCategory(memories);

	assert.deepEqual(
		groups.map((group) => [group.category, group.memories.map((memory) => memory.id)]),
		[
			["profile", ["1"]],
			["general", ["2", "3"]],
		]
	);
});
