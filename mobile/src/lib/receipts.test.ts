import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/chat-receipts.json";
import { buildReceipts } from "@/lib/receipts";

// The same fixture drives the web suite (tests/chat-receipts.test.mjs), so
// Android and web produce identical receipts for the same persisted parts.
describe("buildReceipts", () => {
	for (const { name, parts, expected } of fixture.cases) {
		it(name, () => {
			// Strict so an `undo: undefined` key can't pass where the fixture has none.
			expect(buildReceipts(parts)).toStrictEqual(expected);
		});
	}
});
