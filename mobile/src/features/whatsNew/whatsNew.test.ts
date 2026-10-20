import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	WHATS_NEW_ROUTES,
	filterEntries,
	formatReleaseDate,
	groupByMonth,
	primaryKind,
	type WhatsNewEntry,
} from "./whatsNew";

const entry = (overrides: Partial<WhatsNewEntry>): WhatsNewEntry => ({
	version: "1.0.0",
	versionCode: 1,
	date: "2026-10-19",
	sections: [{ kind: "improved", items: ["Something better"] }],
	title: "Release",
	headline: null,
	why: null,
	verse: null,
	target: null,
	...overrides,
});

const appDir = path.resolve(__dirname, "../../../app/(app)");

describe("whatsNew", () => {
	it("maps every target to a route file that exists in this app", () => {
		for (const route of Object.values(WHATS_NEW_ROUTES)) {
			const href = String(route);
			const file = href === "/" ? "index.tsx" : `${href.slice(1)}.tsx`;
			const asIndex = `${href.slice(1)}/index.tsx`;
			const exists = [file, asIndex].some((candidate) => {
				try {
					readFileSync(path.join(appDir, candidate));
					return true;
				} catch {
					return false;
				}
			});
			expect(exists, href).toBe(true);
		}
	});

	it("covers every target the server can send", () => {
		const rules = readFileSync(path.resolve(__dirname, "../../../../src/lib/whats-new-rules.ts"), "utf8");
		const block = /WHATS_NEW_TARGETS = \[([\s\S]*?)\]/.exec(rules)?.[1] ?? "";
		const serverTargets = [...block.matchAll(/"(\w+)"/g)].map((match) => match[1]).sort();
		expect(Object.keys(WHATS_NEW_ROUTES).sort()).toEqual(serverTargets);
	});

	it("filters by change type and by every search word, like the web journal", () => {
		const entries = [
			entry({ version: "1.2.0", title: "Sermon studies", sections: [{ kind: "new", items: ["Sermons from your church"] }] }),
			entry({ version: "1.1.0", title: "Fixes", sections: [{ kind: "fixed", items: ["Reader scroll"] }] }),
		];
		expect(filterEntries(entries, "", null)).toHaveLength(2);
		expect(filterEntries(entries, "", "fixed").map((e) => e.version)).toEqual(["1.1.0"]);
		expect(filterEntries(entries, "sermon church", null).map((e) => e.version)).toEqual(["1.2.0"]);
		expect(filterEntries(entries, "sermon reader", null)).toEqual([]);
		expect(filterEntries(entries, "  1.1.0 ", null).map((e) => e.version)).toEqual(["1.1.0"]);
	});

	it("names a release by its new work first", () => {
		expect(primaryKind(entry({ sections: [{ kind: "fixed", items: ["a"] }, { kind: "new", items: ["b"] }] }))).toBe("new");
		expect(primaryKind(entry({ sections: [{ kind: "fixed", items: ["a"] }] }))).toBe("fixed");
		expect(primaryKind(entry({ sections: [] }))).toBe("improved");
	});

	it("formats dates without a time zone and groups by month", () => {
		expect(formatReleaseDate("2026-10-01")).toBe("October 1, 2026");
		const groups = groupByMonth([
			entry({ version: "3", date: "2026-10-19" }),
			entry({ version: "2", date: "2026-10-02" }),
			entry({ version: "1", date: "2026-09-30" }),
		]);
		expect(groups.map((g) => [g.month, g.entries.length])).toEqual([
			["October 2026", 2],
			["September 2026", 1],
		]);
	});
});
