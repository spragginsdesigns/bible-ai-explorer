/** A durable server operation fences every note write after stream loss or departure. */
export type NoteOperationReceipt = { id: string; state: "reserved" | "running" | "settled" | "cancelled" };
export type NoteOperationState = "checking" | "editable" | "preparing" | "running" | "recovering" | "failed";
interface PendingOperation { id: string; noteId: string; accountId: string }
interface Dependencies {
	accountId: string;
	noteId: string;
	newId: () => string;
	isCurrent: () => boolean;
	storage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void>; removeItem: (key: string) => Promise<void> };
	prepare: () => Promise<boolean>;
	reserve: (body: Record<string, unknown>) => Promise<NoteOperationReceipt>;
	read: (id: string) => Promise<NoteOperationReceipt>;
	cancel: (id: string) => Promise<NoteOperationReceipt>;
	canonical: () => Promise<string | null>;
	adopt: (html: string) => boolean | Promise<boolean>;
	changed: (state: NoteOperationState, error: string | null) => void;
}
// One writer grant per account/note. A closed editor's late read cannot replace its successor.
let nextGrant = 0;
const grants = new Map<string, { lease: symbol; order: number }>();
const ledgerQueues = new Map<string, Promise<unknown>>();
const terminal = (receipt: NoteOperationReceipt) => receipt.state === "settled" || receipt.state === "cancelled";

export function createNoteAIOperation(deps: Dependencies) {
	const key = `sureword.note-ai-operation.v1:${encodeURIComponent(deps.accountId)}:${encodeURIComponent(deps.noteId)}`;
	const lease = Symbol(key);
	const order = ++nextGrant;
	let alive = true;
	let state: NoteOperationState = "checking";
	let pending: PendingOperation | null = null;
	let epoch = 0;
	let recovery: Promise<boolean> | null = null;
	const isCurrent = () => alive && grants.get(key)?.lease === lease && deps.isCurrent();
	const setState = (next: NoteOperationState, error: string | null = null) => {
		state = next;
		if (isCurrent()) deps.changed(next, error);
	};
	const owned = () => { if (!isCurrent()) throw new Error("The note or reading account changed."); };
	const storage = <T>(action: () => Promise<T>): Promise<T> => {
		const run = (ledgerQueues.get(key) ?? Promise.resolve()).then(action);
		const tail = run.then(() => undefined, () => undefined);
		ledgerQueues.set(key, tail);
		void tail.finally(() => { if (ledgerQueues.get(key) === tail) ledgerQueues.delete(key); });
		return run;
	};
	const checked = (receipt: NoteOperationReceipt, id: string) => {
		if (receipt.id.toLowerCase() !== id.toLowerCase() || !["reserved", "running", "settled", "cancelled"].includes(receipt.state)) throw new Error("The note safety receipt did not match this request.");
		return receipt;
	};
	const load = async () => {
		const raw = await storage(() => deps.storage.getItem(key));
		owned();
		if (raw === null) return null;
		const value = JSON.parse(raw) as Partial<PendingOperation>;
		if (!value || value.accountId !== deps.accountId || value.noteId !== deps.noteId || typeof value.id !== "string" || !/^[0-9a-f-]{36}$/i.test(value.id)) throw new Error("The saved AI safety status could not be read.");
		return value as PendingOperation;
	};
	const recover = (expectedId?: string): Promise<boolean> => {
		if (expectedId && pending?.id !== expectedId) return Promise.resolve(pending === null);
		if (recovery) return recovery;
		const currentEpoch = ++epoch;
		setState("recovering");
		recovery = (async () => {
			try {
				owned();
				pending ??= await load();
				if (pending) {
					const attempt = pending;
					let receipt: NoteOperationReceipt;
					try { receipt = checked(await deps.read(attempt.id), attempt.id); }
					catch { receipt = checked(await deps.cancel(attempt.id), attempt.id); }
					owned();
					if (!terminal(receipt)) receipt = checked(await deps.cancel(attempt.id), attempt.id);
					owned();
					if (!terminal(receipt)) throw new Error("The assistant is still changing this note. Check again before editing.");
					const html = await deps.canonical();
					owned();
					if (currentEpoch !== epoch || html === null || !await deps.adopt(html)) throw new Error("The saved note could not be reloaded. Editing remains paused.");
					owned();
					if (currentEpoch !== epoch) throw new Error("The note changed during reload.");
					await storage(async () => {
						owned();
						const raw = await deps.storage.getItem(key);
						owned();
						if (raw !== null && (JSON.parse(raw) as PendingOperation).id !== attempt.id) throw new Error("A newer note request owns the saved safety status.");
						await deps.storage.removeItem(key);
					});
					owned();
					pending = null;
				}
				owned();
				if (epoch !== currentEpoch) return false;
				setState("editable");
				return true;
			} catch (error) {
				setState("failed", error instanceof Error ? error.message : "The saved note could not be checked. Editing remains paused.");
				return false;
			} finally { recovery = null; }
		})();
		return recovery;
	};
	return {
		isCurrent,
		canEdit: () => isCurrent() && state === "editable",
		// The initial, explicitly awaited flush may drain while UI input is paused.
		canSave: () => isCurrent() && (state === "editable" || state === "preparing"),
		initialize: async () => {
			const granted = grants.get(key);
			if (granted && granted.order > order) return false;
			grants.set(key, { lease, order });
			alive = true;
			const initializingEpoch = ++epoch;
			try {
				const saved = await load();
				if (epoch !== initializingEpoch) return false;
				pending = saved;
				if (pending) {
					if (recovery) await recovery;
					owned();
					return await recover();
				}
				setState("editable");
				return true;
			} catch (error) {
				setState("failed", error instanceof Error ? error.message : "The saved AI safety status could not be read.");
				return false;
			}
		},
		begin: async (body: Record<string, unknown>) => {
			owned();
			if (state !== "editable" || recovery) throw new Error("Check the saved note before asking another question.");
			const currentEpoch = ++epoch;
			setState("preparing");
			if (!await deps.prepare()) {
				if (isCurrent() && epoch === currentEpoch) setState("editable", "Your note could not be saved. Please try again before asking the assistant.");
				throw new Error("The note could not be saved.");
			}
			owned();
			if (currentEpoch !== epoch) throw new Error("The assistant request was stopped.");
			const attempt = { id: deps.newId(), noteId: deps.noteId, accountId: deps.accountId };
			pending = attempt;
			const request: Record<string, unknown> & { noteId: string; operationId: string } = { ...body, noteId: deps.noteId, operationId: attempt.id };
			setState("running");
			try {
				await storage(() => { owned(); return deps.storage.setItem(key, JSON.stringify(attempt)); });
				owned();
				if (currentEpoch !== epoch) throw new Error("The assistant request was stopped.");
				const receipt = checked(await deps.reserve(request), attempt.id);
				owned();
				if (currentEpoch !== epoch || receipt.state !== "reserved") throw new Error("This assistant request cannot be started again.");
				return request;
			} catch (error) { await recover(attempt.id); throw error; }
		},
		recover,
		dispose: () => { alive = false; epoch += 1; },
	};
}
export type NoteAIOperationController = ReturnType<typeof createNoteAIOperation>;

/** A delayed completion belongs to its own assistant row, never a newer question. */
export function userForNoteReply(messages: readonly { id: string; role: string }[], assistantId: string): string | null {
	const index = messages.findIndex(message => message.id === assistantId && message.role === "assistant");
	if (index < 0) return null;
	for (let previous = index - 1; previous >= 0; previous -= 1) if (messages[previous].role === "user") return messages[previous].id;
	return null;
}
