import { describe, expect, it } from "vitest";
import {
	afterTabDepartureGuard,
	registerTabDepartureGuard,
} from "./tabDeparture";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe("tab departure guard", () => {
	it("navigates immediately when no editor is guarding departure", async () => {
		let navigations = 0;

		expect(await afterTabDepartureGuard(() => navigations++)).toBe(true);
		expect(navigations).toBe(1);
	});

	it("waits for a delayed save before navigating", async () => {
		const save = deferred<boolean>();
		const unregister = registerTabDepartureGuard(() => save.promise);
		let navigations = 0;

		const departure = afterTabDepartureGuard(() => navigations++);
		await Promise.resolve();
		expect(navigations).toBe(0);

		save.resolve(true);
		expect(await departure).toBe(true);
		expect(navigations).toBe(1);
		unregister();
	});

	it("blocks navigation when the guard returns false or rejects", async () => {
		let navigations = 0;
		const unregisterFalse = registerTabDepartureGuard(async () => false);

		expect(await afterTabDepartureGuard(() => navigations++)).toBe(false);
		expect(navigations).toBe(0);
		unregisterFalse();

		const unregisterRejected = registerTabDepartureGuard(async () => {
			throw new Error("save failed");
		});
		expect(await afterTabDepartureGuard(() => navigations++)).toBe(false);
		expect(navigations).toBe(0);
		unregisterRejected();
	});

	it("drops stale navigation when the guard is replaced during a save", async () => {
		const save = deferred<boolean>();
		const unregisterOld = registerTabDepartureGuard(() => save.promise);
		let navigations = 0;

		const departure = afterTabDepartureGuard(() => navigations++);
		const unregisterNew = registerTabDepartureGuard(async () => true);
		save.resolve(true);

		expect(await departure).toBe(false);
		expect(navigations).toBe(0);
		unregisterOld();
		expect(await afterTabDepartureGuard(() => navigations++)).toBe(true);
		expect(navigations).toBe(1);
		unregisterNew();
	});

	it("does not let an old cleanup remove a newer guard", async () => {
		let navigations = 0;
		const unregisterOld = registerTabDepartureGuard(async () => false);
		const unregisterNew = registerTabDepartureGuard(async () => true);

		unregisterOld();
		expect(await afterTabDepartureGuard(() => navigations++)).toBe(true);
		expect(navigations).toBe(1);
		unregisterNew();
	});
});
