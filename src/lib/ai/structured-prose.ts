import { verifyGeneratedAnswer, type VerifyAnswerOptions } from "./verified-generation";

export class StructuredProseRejectedError extends Error {
	constructor() { super("Generated content could not be verified within its final shape and deadline."); }
}
export interface ProseField<T> {
	id: string;
	read: (payload: T) => string;
	write: (payload: T, text: string) => T;
}
/** One absolute clock includes source reads, review, repair and write margin. */
export function remainingProseTime(deadlineAt: number, ceilingMs: number, reserveMs = 0, now = Date.now()): number {
	const remaining = Math.min(ceilingMs, Math.floor(deadlineAt - now - reserveMs));
	// The shared verifier rounds subsecond budgets upward. Do not let that
	// rounding spend the persistence reservation.
	if (!Number.isFinite(remaining) || remaining < 1000) throw new StructuredProseRejectedError();
	return remaining;
}
export async function beforeProseDeadline<T>(deadlineAt: number, reserveMs: number, work: (timeoutMs: number) => Promise<T>): Promise<T> {
	const timeoutMs = remainingProseTime(deadlineAt, Number.MAX_SAFE_INTEGER, reserveMs);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new StructuredProseRejectedError()), timeoutMs); });
	try { return await Promise.race([work(timeoutMs), deadline]); }
	finally { clearTimeout(timer); }
}
/** Check all editable prose in one gate job, then validate exact final bytes. */
export async function verifyStructuredProse<T>(payload: T, options: {
	fields: readonly ProseField<T>[];
	immutable: (payload: T) => unknown;
	validate: (payload: T) => boolean;
	verification: Omit<VerifyAnswerOptions, "timeoutMs">;
	deadlineAt: number;
	persistenceReserveMs: number;
}): Promise<T> {
	options.verification.signal?.throwIfAborted();
	if (!options.validate(payload)) throw new StructuredProseRejectedError();
	const snapshot = JSON.stringify(options.immutable(payload));
	const fields = options.fields;
	const ids = fields.map(field => field.id);
	if (!fields.length || fields.length > 32 || new Set(ids).size !== ids.length) throw new StructuredProseRejectedError();
	const blocks = fields.map(field => ({ id: field.id, text: field.read(payload) }));
	const timeoutMs = remainingProseTime(options.deadlineAt, 75_000, options.persistenceReserveMs);
	const checked = await beforeProseDeadline(options.deadlineAt, options.persistenceReserveMs, () => verifyGeneratedAnswer(blocks, { ...options.verification, timeoutMs }));
	if (!checked.verified || checked.blocks.length !== ids.length || checked.blocks.some((block, index) => block.id !== ids[index] || typeof block.text !== "string")) throw new StructuredProseRejectedError();
	let final = structuredClone(payload);
	for (let index = 0; index < fields.length; index++) final = fields[index].write(final, checked.blocks[index].text);
	// No trim, clipping, dash cleanup or sanitizer follows this final check.
	if (JSON.stringify(options.immutable(final)) !== snapshot || !options.validate(final)) throw new StructuredProseRejectedError();
	remainingProseTime(options.deadlineAt, Number.MAX_SAFE_INTEGER, options.persistenceReserveMs);
	options.verification.signal?.throwIfAborted();
	return final;
}
