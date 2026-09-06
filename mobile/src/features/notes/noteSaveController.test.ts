import { describe, expect, it } from "vitest";
import { createNoteSaveController } from "./noteSaveController";

describe("createNoteSaveController", () => {
	it("waits for an outstanding capture, then flushes the newest HTML", async () => {
		let captureCount = 0;
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
		const saved: string[] = [];
		const controller = createNoteSaveController(
			"initial",
			async () => {
				captureCount += 1;
				if (captureCount === 1) await firstGate;
				return captureCount === 1 ? "older" : "newest";
			},
			async (html) => {
				saved.push(html);
			}
		);

		const autosave = controller.enqueue();
		const flush = controller.flush();
		await Promise.resolve();
		expect(saved).toEqual([]);
		releaseFirst();
		await Promise.all([autosave, flush]);
		expect(saved).toEqual(["older", "newest"]);
	});

	it("keeps the same HTML dirty after failure and retries it", async () => {
		let attempts = 0;
		const controller = createNoteSaveController(
			"initial",
			async () => "draft",
			async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("offline");
			}
		);

		expect(await controller.flush()).toBe(false);
		expect(await controller.flush()).toBe(true);
		expect(attempts).toBe(2);
	});

	it("does not save clean HTML again after success", async () => {
		let saves = 0;
		const controller = createNoteSaveController(
			"initial",
			async () => "draft",
			async () => {
				saves += 1;
			}
		);

		await controller.flush();
		await controller.flush();
		expect(saves).toBe(1);
	});

	it("invalidates a queued capture after replaceContent", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const saved: string[] = [];
		const controller = createNoteSaveController(
			"initial",
			async () => {
				await gate;
				return "stale capture";
			},
			async (html) => {
				saved.push(html);
			}
		);

		const pending = controller.enqueue();
		await Promise.resolve();
		controller.replaceContent("AI result");
		release();
		await pending;
		expect(saved).toEqual([]);
	});

	it("last chance save waits behind an outstanding save", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const saved: string[] = [];
		const controller = createNoteSaveController(
			"initial",
			async () => "draft",
			async (html) => {
				saved.push(html);
				await gate;
			}
		);

		const pending = controller.enqueue();
		const lastChance = controller.lastChance();
		let lastChanceSettled = false;
		void lastChance.then(() => {
			lastChanceSettled = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(saved).toEqual(["draft"]);
		expect(lastChanceSettled).toBe(false);
		release();
		await Promise.all([pending, lastChance]);
		expect(saved).toEqual(["draft"]);
		expect(lastChanceSettled).toBe(true);
	});

	it("never saves stale content or authorizes departure after a capture timeout", async () => {
		let release!: (value: string) => void;
		const stale = new Promise<string>((resolve) => { release = resolve; });
		let captures = 0;
		const saved: string[] = [];
		const controller = createNoteSaveController(
			"initial",
			() => ++captures === 1 ? stale : Promise.resolve(null),
			async (html) => { saved.push(html); }
		);
		const pending = controller.enqueue();
		await Promise.resolve();
		controller.replaceContent("AI result");
		release("old capture");
		await pending;
		expect(await controller.flush()).toBe(false);
		await controller.lastChance();
		expect(saved).toEqual([]);
	});

	it("reports a missed capture and retries the real document before allowing departure", async () => {
		let captureCount = 0;
		const errors: string[] = [];
		const saved: string[] = [];
		const controller = createNoteSaveController(
			"",
			async () => ++captureCount === 1 ? null : "latest draft",
			async (html) => { saved.push(html); },
			(message) => { errors.push(message); }
		);
		expect(await controller.flush()).toBe(false);
		expect(errors).toHaveLength(1);
		expect(saved).toEqual([]);
		expect(await controller.flush()).toBe(true);
		expect(saved).toEqual(["latest draft"]);
	});
});
