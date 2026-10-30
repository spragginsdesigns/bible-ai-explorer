import { describe, expect, it, vi } from "vitest";
import { createNoteAIOperation, userForNoteReply, type NoteOperationReceipt } from "./noteAIOperation";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let sequence = 0;
function harness(noteId = `test-note-${++sequence}`, values = new Map<string, string>()) {
	let current = true;
	let id = 0;
	const states: string[] = [];
	const adopted: string[] = [];
	const storage = {
		getItem: vi.fn(async (key: string) => values.get(key) ?? null),
		setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
		removeItem: vi.fn(async (key: string) => { values.delete(key); }),
	};
	const deps = {
		accountId: "owner", noteId, newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
		isCurrent: () => current, storage,
		prepare: vi.fn(async () => true),
		reserve: vi.fn(async (body: Record<string, unknown>): Promise<NoteOperationReceipt> => ({ id: String(body.operationId), state: "reserved" })),
		read: vi.fn(async (operationId: string): Promise<NoteOperationReceipt> => ({ id: operationId, state: "settled" })),
		cancel: vi.fn(async (operationId: string): Promise<NoteOperationReceipt> => ({ id: operationId, state: "cancelled" })),
		canonical: vi.fn(async (): Promise<string | null> => "<p>saved rewrite</p>"),
		adopt: vi.fn(async (html: string) => { adopted.push(html); return true; }),
		changed: (state: string) => { states.push(state); },
	};
	return { controller: createNoteAIOperation(deps), deps, values, states, adopted, invalidate: () => { current = false; } };
}
const body = { noteId: "ignored", messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Rewrite this note" }] }], timezone: "America/Los_Angeles" };

describe("durable note AI operations", () => {
	it("an abandoned React render cannot revoke the committed editor's grant", async () => {
		const h = harness(); await h.controller.initialize(); await h.controller.begin(body);
		const abandoned = harness(h.deps.noteId, h.values);
		expect(abandoned.controller.canEdit()).toBe(false);
		expect(await h.controller.recover()).toBe(true);
		expect(h.adopted).toHaveLength(1);
	});

	it("effect cleanup and replay can reacquire their unchanged editor grant", async () => {
		const h = harness(); await h.controller.initialize(); h.controller.dispose();
		expect(h.controller.canSave()).toBe(false);
		expect(await h.controller.initialize()).toBe(true);
		expect(h.controller.canEdit()).toBe(true);
	});

	it("a failed draft flush never reserves AI or overwrites the visible draft", async () => {
		const h = harness(); await h.controller.initialize(); h.deps.prepare.mockResolvedValueOnce(false);
		await expect(h.controller.begin(body)).rejects.toThrow("could not be saved");
		expect(h.deps.reserve).not.toHaveBeenCalled(); expect(h.deps.canonical).not.toHaveBeenCalled();
		expect(h.controller.canEdit()).toBe(true);
	});

	it("reserves the exact stream body only after its safety record is durable", async () => {
		const h = harness(); await h.controller.initialize();
		const stored = deferred<void>(); h.deps.storage.setItem.mockImplementationOnce(async (key, value) => { await stored.promise; h.values.set(key, value); });
		const begin = h.controller.begin(body);
		await vi.waitFor(() => expect(h.deps.storage.setItem).toHaveBeenCalledOnce());
		expect(h.deps.reserve).not.toHaveBeenCalled(); expect(h.controller.canSave()).toBe(false);
		stored.resolve(); const request = await begin;
		expect(h.deps.reserve).toHaveBeenCalledWith(request); expect(request.messages).toEqual(body.messages);
		expect(request.noteId).toBe(h.deps.noteId); expect(request.operationId).toMatch(/^00000000-/);
		expect(h.controller.canEdit()).toBe(false);
	});

	it("keeps editing locked until terminal receipt, canonical read and bridge adoption finish", async () => {
		const h = harness(); await h.controller.initialize(); await h.controller.begin(body);
		const canonical = deferred<string | null>(); h.deps.canonical.mockReturnValueOnce(canonical.promise);
		const bridge = deferred<boolean>(); h.deps.adopt.mockReturnValueOnce(bridge.promise);
		const finish = h.controller.recover();
		await vi.waitFor(() => expect(h.deps.canonical).toHaveBeenCalledOnce());
		expect(h.controller.canSave()).toBe(false); expect(h.values.size).toBe(1);
		canonical.resolve("<p>rewritten note</p>");
		await vi.waitFor(() => expect(h.deps.adopt).toHaveBeenCalledOnce());
		expect(h.controller.canEdit()).toBe(false); bridge.resolve(true);
		expect(await finish).toBe(true); expect(h.controller.canEdit()).toBe(true); expect(h.values.size).toBe(0);
	});

	it("cancels a running operation after stream loss before reloading canonical content", async () => {
		const h = harness(); await h.controller.initialize(); const request = await h.controller.begin(body);
		h.deps.read.mockResolvedValueOnce({ id: request.operationId, state: "running" });
		const cancellation = deferred<NoteOperationReceipt>(); h.deps.cancel.mockReturnValueOnce(cancellation.promise);
		const recovery = h.controller.recover();
		await vi.waitFor(() => expect(h.deps.cancel).toHaveBeenCalledWith(request.operationId));
		expect(h.deps.canonical).not.toHaveBeenCalled(); expect(h.controller.canSave()).toBe(false);
		cancellation.resolve({ id: request.operationId, state: "cancelled" });
		expect(await recovery).toBe(true); expect(h.adopted).toEqual(["<p>saved rewrite</p>"]);
	});

	it("restores a pending operation after the previous editor disappears", async () => {
		const h = harness(); await h.controller.initialize(); const request = await h.controller.begin(body); h.controller.dispose();
		const next = harness(h.deps.noteId, h.values);
		expect(next.controller.canSave()).toBe(false); expect(await next.controller.initialize()).toBe(true);
		expect(next.deps.read).toHaveBeenCalledWith(request.operationId); expect(next.adopted).toHaveLength(1); expect(next.controller.canEdit()).toBe(true);
	});

	it("rejects a predecessor editor's held canonical response after a successor claims the note", async () => {
		const h = harness(); await h.controller.initialize(); await h.controller.begin(body);
		const held = deferred<string | null>(); h.deps.canonical.mockReturnValueOnce(held.promise);
		const recovery = h.controller.recover(); await vi.waitFor(() => expect(h.deps.canonical).toHaveBeenCalledOnce());
		const next = harness(h.deps.noteId, h.values); await next.controller.initialize();
		held.resolve("<p>stale predecessor</p>"); expect(await recovery).toBe(false);
		expect(h.adopted).toEqual([]); expect(next.adopted).toEqual(["<p>saved rewrite</p>"]);
	});

	it("fences a lost reservation response with cancellation and never replays the request", async () => {
		const h = harness(); await h.controller.initialize(); h.deps.reserve.mockRejectedValueOnce(new Error("connection lost"));
		h.deps.read.mockRejectedValueOnce(new Error("not found"));
		await expect(h.controller.begin(body)).rejects.toThrow("connection lost");
		expect(h.deps.reserve).toHaveBeenCalledOnce(); expect(h.deps.cancel).toHaveBeenCalledOnce(); expect(h.controller.canEdit()).toBe(true);
	});

	it("keeps the durable fence when cancellation or canonical loading fails", async () => {
		const h = harness(); await h.controller.initialize(); await h.controller.begin(body);
		h.deps.canonical.mockResolvedValueOnce(null);
		expect(await h.controller.recover()).toBe(false); expect(h.controller.canSave()).toBe(false); expect(h.values.size).toBe(1);
		expect(await h.controller.recover()).toBe(true); expect(h.values.size).toBe(0);
	});

	it("never sends a new request or unlocks editing when the recovery ledger is unreadable", async () => {
		const h = harness(); h.deps.storage.getItem.mockRejectedValue(new Error("storage unavailable"));
		expect(await h.controller.initialize()).toBe(false); await expect(h.controller.begin(body)).rejects.toThrow();
		expect(h.deps.reserve).not.toHaveBeenCalled(); expect(h.controller.canEdit()).toBe(false);
	});

	it("an old stream completion cannot cancel a newer operation", async () => {
		const h = harness(); await h.controller.initialize(); const first = await h.controller.begin(body); await h.controller.recover(first.operationId);
		const second = await h.controller.begin(body); expect(await h.controller.recover(first.operationId)).toBe(false);
		expect(h.controller.canSave()).toBe(false); expect(h.deps.cancel).not.toHaveBeenCalled();
		await h.controller.recover(second.operationId);
	});

	it("a Stop during held reservation prevents its later response from authorizing the stream", async () => {
		const h = harness(); await h.controller.initialize(); const reserved = deferred<NoteOperationReceipt>(); h.deps.reserve.mockReturnValueOnce(reserved.promise);
		const begin = h.controller.begin(body); const rejected = expect(begin).rejects.toThrow("cannot be started");
		await vi.waitFor(() => expect(h.deps.reserve).toHaveBeenCalledOnce());
		const operationId = String(h.deps.reserve.mock.calls[0][0].operationId);
		await h.controller.recover(operationId); const next = await h.controller.begin(body);
		reserved.resolve({ id: operationId, state: "reserved" }); await rejected;
		expect(h.controller.canEdit()).toBe(false); expect(await h.controller.recover(next.operationId)).toBe(true);
	});
});

it("a delayed old assistant completion cannot recover the current generation's request", async () => {
	const h = harness(); await h.controller.initialize();
	const old = await h.controller.begin(body); await h.controller.recover(old.operationId);
	const current = await h.controller.begin(body);
	const runs = new Map([["old-user", old.operationId], ["new-user", current.operationId]]);
	const messages = [{ id: "old-user", role: "user" }, { id: "old-answer", role: "assistant" }, { id: "new-user", role: "user" }, { id: "new-answer", role: "assistant" }];
	const reads = h.deps.read.mock.calls.length;
	const oldUser = userForNoteReply(messages, "old-answer");
	expect(oldUser).toBe("old-user");
	expect(await h.controller.recover(runs.get(oldUser!)!)).toBe(false);
	expect(h.deps.read.mock.calls.length).toBe(reads);
	expect(h.controller.canSave()).toBe(false);
	expect(userForNoteReply(messages, "removed-answer")).toBeNull();
	expect(userForNoteReply(messages, "new-answer")).toBe("new-user");
	await h.controller.recover(current.operationId);
});
