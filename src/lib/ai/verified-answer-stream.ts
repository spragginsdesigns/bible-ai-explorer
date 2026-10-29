import type { UIMessageChunk } from "ai";
import type { AnswerBlock, GatedAnswer } from "./answer-gate";

type Field = { id: string; object: Record<string, unknown>; key: string; text: string; max: number };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only fields actually projected into answer cards; opaque action IDs stay exact. */
function cardFields(chunks: UIMessageChunk[]): Field[] {
	const names = new Map<string, string>();
	const fields: Field[] = [];
	for (const chunk of chunks) {
		if (chunk.type === "tool-input-available") names.set(chunk.toolCallId, chunk.toolName);
		if (chunk.type !== "tool-output-available") continue;
		const name = names.get(chunk.toolCallId);
		const output = object(chunk.output);
		const add = (target: Record<string, unknown>, key: string, suffix: string, max = 2000) => {
			const text = target[key];
			if (typeof text === "string" && text.trim()) fields.push({ id: `card:${chunk.toolCallId}:${suffix}`, object: target, key, text, max });
		};
		if (name === "presentChoices") {
			add(output, "question", "question", 400);
			add(output, "skipLabel", "skipLabel", 160);
			if (Array.isArray(output.options)) output.options.forEach((_, i) => add(output.options as unknown as Record<string, unknown>, String(i), `option-${i}`, 200));
		} else if (name === "showInApp" || name === "showProfileEditor") {
			add(output, "caption", "caption", 200);
			if (Array.isArray(output.stops)) output.stops.forEach((stop, i) => add(object(stop), "caption", `stop-${i}`, 400));
		} else if (name === "setDailyCross") {
			add(output, "reason", "reason");
		} else if (name === "addToNote" || name === "updateNote") add(output, "noteTitle", "noteTitle", 300);
		else if (name === "organizeNote" || name === "startReadingPlan") add(output, "title", "title", 300);
	}
	return fields;
}

/**
 * Buffer the SDK UI stream, including tool arguments, until validation ends.
 * Preserve its IDs and step/tool ordering, replacing only whole text blocks.
 */
export async function releaseVerifiedAnswer<CHUNK extends UIMessageChunk>(options: {
	stream: ReadableStream<CHUNK>;
	write: (chunk: CHUNK) => void;
	verify: (blocks: AnswerBlock[]) => Promise<GatedAnswer>;
	onChecking?: () => void;
}): Promise<GatedAnswer> {
	const chunks: CHUNK[] = [];
	const blocks = new Map<string, string>();
	const reader = options.stream.getReader();
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += JSON.stringify(value).length;
			if (bytes > 2_000_000 || chunks.length >= 40_000) throw new Error("Answer buffer limit exceeded");
			if (value.type === "error" || value.type === "abort") throw new Error("Draft generation did not complete");
			if (value.type.startsWith("reasoning") || value.type === "tool-input-start" || value.type === "tool-input-delta") continue;
			chunks.push(value);
			if (value.type === "text-start") {
				if (blocks.has(value.id)) throw new Error("Duplicate answer text id");
				blocks.set(value.id, "");
			}
			if (value.type === "text-delta") {
				if (!blocks.has(value.id)) throw new Error("Answer text has no start");
				blocks.set(value.id, blocks.get(value.id)! + value.delta);
			}
		}
	} finally { reader.releaseLock(); }
	options.onChecking?.();
	const fields = cardFields(chunks);
	const allBlocks = [...blocks].map(([id, text]) => ({ id, text })).concat(fields.map(({ id, text }) => ({ id, text })));
	let result = await options.verify(allBlocks);
	const verified = new Map(result.blocks.map(block => [block.id, block.text]));
	// Card text cannot turn into a multi-paragraph canonical passage or exceed
	// its client contract during repair. A rejected card remains hidden.
	const invalidCard = fields.some(field => !verified.has(field.id) || verified.get(field.id)!.length > field.max || /\[\[SCRIPTURE:/i.test(verified.get(field.id)!));
	if (invalidCard && result.verified) throw new Error("Verified card text violates its display contract");
	for (const field of fields) field.object[field.key] = result.verified ? verified.get(field.id)! : "";
	// Input deltas are never replayed, and model-authored card arguments must
	// not preserve rejected text in the delivered/persisted tool part either.
	for (const chunk of chunks) {
		if (chunk.type !== "tool-input-available") continue;
		const input = object(chunk.input);
		if (chunk.toolName === "showInApp" || chunk.toolName === "showProfileEditor") input.caption = verified.get(`card:${chunk.toolCallId}:caption`) || "Content withheld after Scripture checking.";
		if (chunk.toolName === "presentChoices") {
			if (typeof input.question === "string") input.question = verified.get(`card:${chunk.toolCallId}:question`) || null;
			if (Array.isArray(input.options)) input.options = input.options.map((_, i) => verified.get(`card:${chunk.toolCallId}:option-${i}`) || "Continue");
		}
	}
	// Separate output prose from card fields when constructing a fallback turn.
	if (!result.verified && blocks.size === 0) {
		const fallback = result.blocks.find(block => block.text)?.text ?? "This answer was withheld because Scripture checking did not finish. Please try again.";
		result = { ...result, blocks: [{ id: "verified-answer", text: fallback }] };
	}
	const emitted = new Set<string>();
	for (const chunk of chunks) {
		if (chunk.type === "text-delta") {
			if (emitted.has(chunk.id)) continue;
			emitted.add(chunk.id);
			options.write({ ...chunk, delta: verified.get(chunk.id) ?? "" });
		} else options.write(chunk);
	}
	// Tool-only welcome turns normally need no prose. A failed check still
	// needs a visible outcome, using the standard protocol on every client.
	if (blocks.size === 0 && !result.verified && result.blocks.some(block => block.text)) {
		const block = result.blocks[0];
		options.write({ type: "text-start", id: block.id } as CHUNK);
		options.write({ type: "text-delta", id: block.id, delta: block.text } as CHUNK);
		options.write({ type: "text-end", id: block.id } as CHUNK);
	}
	return result;
}
