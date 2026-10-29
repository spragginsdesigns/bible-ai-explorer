import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type NoteAIWriteOperation = { id: string; userId: string; noteId: string };
export type NoteAIOperationState = "reserved" | "running" | "settled" | "cancelled";
export type NoteAIOperationReceipt = { id: string; state: NoteAIOperationState };

export class NoteAIOperationError extends Error {
	readonly status: number;
	constructor(status: number, message: string) { super(message); this.status = status; }
}

export function noteAIOperationId(value: unknown): string {
	if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		throw new NoteAIOperationError(400, "A valid note operation ID is required.");
	}
	return value.toLowerCase();
}

function canonicalJSON(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Bind a reservation to the exact turn, independently of JSON key ordering. */
export function noteAIRequestHash(body: Record<string, unknown>): string {
	const { operationId: _operationId, ...request } = body;
	return createHash("sha256").update(canonicalJSON(request)).digest("hex");
}

type LockedOperation = NoteAIWriteOperation & { state: NoteAIOperationState; requestHash: string | null };
const transactionOptions = { maxWait: 5_000, timeout: 10_000 };

async function lockOperation(db: Prisma.TransactionClient, operation: NoteAIWriteOperation): Promise<LockedOperation> {
	const rows = await db.$queryRaw<LockedOperation[]>`
		SELECT "id", "userId", "noteId", "state", "requestHash" FROM "NoteAIOperation"
		WHERE "id" = ${operation.id} AND "userId" = ${operation.userId} AND "noteId" = ${operation.noteId}
		FOR UPDATE`;
	if (!rows[0]) throw new NoteAIOperationError(404, "Note operation not found.");
	return rows[0];
}

async function assertOwnedNote(db: Prisma.TransactionClient, operation: NoteAIWriteOperation) {
	if (!await db.note.findFirst({ where: { id: operation.noteId, userId: operation.userId }, select: { id: true } })) {
		throw new NoteAIOperationError(404, "Note not found.");
	}
}

/** Idempotent reservation. A lost response can be retried without executing AI. */
export async function reserveNoteAIOperation(operation: NoteAIWriteOperation, requestHash: string): Promise<NoteAIOperationReceipt> {
	return prisma.$transaction(async db => {
		await assertOwnedNote(db, operation);
		await db.$executeRaw`INSERT INTO "NoteAIOperation" ("id", "userId", "noteId", "requestHash", "state", "updatedAt")
			VALUES (${operation.id}, ${operation.userId}, ${operation.noteId}, ${requestHash}, 'reserved', NOW())
			ON CONFLICT ("id") DO NOTHING`;
		const row = await lockOperation(db, operation);
		// Cancel-before-reserve deliberately has no hash: it must remain a tombstone.
		if (row.requestHash !== null && row.requestHash !== requestHash) throw new NoteAIOperationError(409, "This note operation belongs to another request.");
		return { id: row.id, state: row.state };
	}, transactionOptions);
}

/** Execution cannot create its own reservation, replay one, or revive cancellation. */
export async function claimNoteAIOperation(operation: NoteAIWriteOperation, requestHash: string): Promise<void> {
	await prisma.$transaction(async db => {
		const row = await lockOperation(db, operation);
		await assertOwnedNote(db, operation);
		if (row.state !== "reserved" || row.requestHash !== requestHash) throw new NoteAIOperationError(409, "This note operation cannot be started again.");
		await db.noteAIOperation.update({ where: { id: operation.id }, data: { state: "running" } });
	}, transactionOptions);
}

/**
 * This row lock is held through the actual note commit, not just its preflight.
 * Cancellation/settlement takes the same lock. Once either returns, no older
 * tool from this operation can write a note, even if its provider is still alive.
 */
export async function withNoteAIWrite<T>(operation: NoteAIWriteOperation | undefined, write: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
	if (!operation) return write(prisma);
	return prisma.$transaction(async db => {
		const row = await lockOperation(db, operation);
		if (row.state !== "running") throw new NoteAIOperationError(409, "This note operation no longer permits changes.");
		await assertOwnedNote(db, operation);
		return write(db);
	}, transactionOptions);
}

/** History uses the same lock so a late persistence task cannot undo Clear. */
export async function withNoteAIHistory<T>(operation: NoteAIWriteOperation | undefined, write: (db: Prisma.TransactionClient) => Promise<T>, allowSettled = false): Promise<{ accepted: true; value: T } | { accepted: false }> {
	if (!operation) return { accepted: true, value: await write(prisma) };
	return prisma.$transaction(async db => {
		const row = await lockOperation(db, operation);
		if (row.state !== "running" && !(allowSettled && row.state === "settled")) return { accepted: false as const };
		await assertOwnedNote(db, operation);
		return { accepted: true as const, value: await write(db) };
	}, transactionOptions);
}

export async function settleNoteAIOperation(operation: NoteAIWriteOperation): Promise<void> {
	await prisma.$transaction(async db => {
		const row = await lockOperation(db, operation);
		if (row.state === "running") await db.noteAIOperation.update({ where: { id: operation.id }, data: { state: "settled" } });
	}, transactionOptions);
}

export async function readNoteAIOperation(operation: NoteAIWriteOperation): Promise<NoteAIOperationReceipt> {
	const row = await prisma.noteAIOperation.findFirst({ where: operation, select: { id: true, state: true } });
	if (!row) throw new NoteAIOperationError(404, "Note operation not found.");
	return { id: row.id, state: row.state as NoteAIOperationState };
}

/**
 * Creating a cancelled tombstone also fences a delayed reservation or POST
 * when the reservation response was lost before the client could observe it.
 */
export async function cancelNoteAIOperation(operation: NoteAIWriteOperation): Promise<NoteAIOperationReceipt> {
	return prisma.$transaction(async db => {
		await assertOwnedNote(db, operation);
		await db.$executeRaw`INSERT INTO "NoteAIOperation" ("id", "userId", "noteId", "state", "updatedAt")
			VALUES (${operation.id}, ${operation.userId}, ${operation.noteId}, 'cancelled', NOW())
			ON CONFLICT ("id") DO NOTHING`;
		const row = await lockOperation(db, operation);
		if (row.state === "reserved" || row.state === "running") {
			await db.noteAIOperation.update({ where: { id: operation.id }, data: { state: "cancelled" } });
			return { id: row.id, state: "cancelled" };
		}
		return { id: row.id, state: row.state };
	}, transactionOptions);
}
