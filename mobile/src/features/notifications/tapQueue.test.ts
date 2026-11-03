import { describe, expect, it, vi } from "vitest";
import { createTapQueue } from "./tapQueue";

describe("createTapQueue", () => {
	it("holds a cold-start tap until the navigator attaches, then routes it once", () => {
		const queue = createTapQueue<string>();
		queue.deliver("cross");
		const route = vi.fn();
		queue.attach(route);
		expect(route).toHaveBeenCalledTimes(1);
		expect(route).toHaveBeenCalledWith("cross");
	});

	it("routes immediately while attached", () => {
		const queue = createTapQueue<string>();
		const route = vi.fn();
		queue.attach(route);
		queue.deliver("chat");
		expect(route).toHaveBeenCalledWith("chat");
	});

	it("keeps only the latest tap while waiting", () => {
		const queue = createTapQueue<string>();
		queue.deliver("first");
		queue.deliver("second");
		const route = vi.fn();
		queue.attach(route);
		expect(route).toHaveBeenCalledTimes(1);
		expect(route).toHaveBeenCalledWith("second");
	});

	it("holds taps again after the navigator detaches", () => {
		const queue = createTapQueue<string>();
		const first = vi.fn();
		const detach = queue.attach(first);
		detach();
		queue.deliver("cross");
		expect(first).not.toHaveBeenCalled();
		const second = vi.fn();
		queue.attach(second);
		expect(second).toHaveBeenCalledWith("cross");
	});

	it("ignores a stale detach from an outlet that was already replaced", () => {
		const queue = createTapQueue<string>();
		const stale = queue.attach(vi.fn());
		const current = vi.fn();
		queue.attach(current);
		stale();
		queue.deliver("cross");
		expect(current).toHaveBeenCalledWith("cross");
	});
});
