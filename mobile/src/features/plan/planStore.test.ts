import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
	fetchReadingPlans: vi.fn(),
	startPresetPlan: vi.fn(),
	startGoalPlan: vi.fn(),
	setPlanDay: vi.fn(),
	archiveReadingPlan: vi.fn(),
}));

import type { GetToken } from "@/lib/api";
import { fetchReadingPlans, startPresetPlan } from "./api";
import {
	clearPlanStore,
	ensureLoaded,
	getPlanSnapshot,
	startPlanPreset,
	subscribePlanStore,
} from "./planStore";
import type { ReadingPlan, ReadingPlanPreset, ReadingPlansView } from "./types";

const mockedFetch = vi.mocked(fetchReadingPlans);
const mockedStartPreset = vi.mocked(startPresetPlan);

const getToken: GetToken = async () => "token";

const preset: ReadingPlanPreset = {
	key: "gospels",
	title: "The Gospels",
	description: "Matthew through John",
	dayCount: 30,
};

function makePlan(id: string): ReadingPlan {
	return {
		id,
		title: `Plan ${id}`,
		description: "",
		source: "preset",
		presetKey: "gospels",
		startDate: "2026-01-01",
		status: "active",
		dayCount: 30,
		todayDay: 1,
		currentDay: 1,
		completedCount: 0,
		percent: 0,
		streak: 0,
		days: [],
	};
}

function makeView(active: ReadingPlan | null): ReadingPlansView {
	return { active, presets: [preset] };
}

beforeEach(() => {
	vi.clearAllMocks();
	clearPlanStore();
});

describe("ensureLoaded", () => {
	it("issues one request for simultaneous mounts", async () => {
		mockedFetch.mockResolvedValue(makeView(null));

		// The three Bible-stack screens mount together; only one GET may leave.
		await Promise.all([ensureLoaded(getToken), ensureLoaded(getToken), ensureLoaded(getToken)]);

		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(getPlanSnapshot().loading).toBe(false);
		expect(getPlanSnapshot().view?.presets).toHaveLength(1);
	});

	it("does not refetch once a response has landed", async () => {
		mockedFetch.mockResolvedValue(makeView(null));
		await ensureLoaded(getToken);
		await ensureLoaded(getToken);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
	});
});

describe("mutations", () => {
	it("shows a started plan to a subscriber that did not run the mutation", async () => {
		mockedFetch.mockResolvedValue(makeView(null));
		await ensureLoaded(getToken);

		// Stands in for the Bible home card / Daily Cross, which only read.
		const seen: (string | null)[] = [];
		const unsubscribe = subscribePlanStore(() => {
			seen.push(getPlanSnapshot().view?.active?.id ?? null);
		});

		mockedStartPreset.mockResolvedValue(makePlan("p1"));
		await startPlanPreset(getToken, "gospels");
		unsubscribe();

		expect(seen).toContain("p1");
		expect(getPlanSnapshot().view?.active?.id).toBe("p1");
		// The POST answers with a plan, not a view: the presets must survive it.
		expect(getPlanSnapshot().view?.presets).toHaveLength(1);
		expect(getPlanSnapshot().busy).toBe(false);
	});
});

describe("clearPlanStore", () => {
	it("drops a response that lands after the account changed", async () => {
		// Assigned synchronously by the Promise executor below.
		let resolveFetch!: (view: ReadingPlansView) => void;
		mockedFetch.mockReturnValue(
			new Promise<ReadingPlansView>((resolve) => {
				resolveFetch = resolve;
			})
		);

		const inFlight = ensureLoaded(getToken);
		clearPlanStore();
		resolveFetch(makeView(makePlan("p1")));
		await inFlight;

		expect(getPlanSnapshot().view).toBeNull();
		expect(getPlanSnapshot().error).toBeNull();
	});

	it("bumps the snapshot generation so a mounted screen reloads, and the reload fetches again", async () => {
		mockedFetch.mockResolvedValue(makeView(makePlan("p1")));
		await ensureLoaded(getToken);
		const before = getPlanSnapshot().generation;
		expect(mockedFetch).toHaveBeenCalledTimes(1);

		const listener = vi.fn();
		subscribePlanStore(listener);
		clearPlanStore();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(getPlanSnapshot().generation).toBe(before + 1);
		expect(getPlanSnapshot().loading).toBe(true);

		// What the hook's effect does when `snapshot.generation` changes.
		mockedFetch.mockResolvedValue(makeView(makePlan("p2")));
		await ensureLoaded(getToken);
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(getPlanSnapshot().view?.active?.id).toBe("p2");
	});

	it("retries on the next mount after a failed load", async () => {
		mockedFetch.mockRejectedValueOnce(new Error("offline"));
		await ensureLoaded(getToken);
		expect(getPlanSnapshot().error).toBe("offline");
		expect(getPlanSnapshot().loading).toBe(false);

		mockedFetch.mockResolvedValue(makeView(makePlan("p1")));
		await ensureLoaded(getToken);
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(getPlanSnapshot().error).toBeNull();
		expect(getPlanSnapshot().view?.active?.id).toBe("p1");
	});
});
