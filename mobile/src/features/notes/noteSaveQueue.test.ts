import { describe, expect, it } from "vitest";
import { createNoteSaveQueue } from "./noteSaveQueue";

describe("createNoteSaveQueue", () => {
	it("runs delayed saves in submission order", async () => {
		const queue = createNoteSaveQueue();
		const events: string[] = [];
		let releaseFirst!: () => void;
		const firstReleased = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = queue(async () => {
			events.push("first-start");
			await firstReleased;
			events.push("first-end");
		});
		const second = queue(async () => {
			events.push("second");
		});

		await Promise.resolve();
		expect(events).toEqual(["first-start"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(events).toEqual(["first-start", "first-end", "second"]);
	});

	it("continues after a failure so the next save can retry", async () => {
		const queue = createNoteSaveQueue();
		const events: string[] = [];
		const first = queue(async () => {
			events.push("failed");
			throw new Error("offline");
		});
		await expect(first).rejects.toThrow("offline");

		await queue(async () => {
			events.push("retry");
		});
		expect(events).toEqual(["failed", "retry"]);
	});

	it("lets flush enqueue behind an outstanding save", async () => {
		const queue = createNoteSaveQueue();
		const events: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		const outstanding = queue(async () => {
			events.push("outstanding");
			await gate;
		});
		const flush = queue(async () => {
			events.push("flush-newest");
		});
		await Promise.resolve();
		expect(events).toEqual(["outstanding"]);
		release();
		await Promise.all([outstanding, flush]);
		expect(events).toEqual(["outstanding", "flush-newest"]);
	});
});
