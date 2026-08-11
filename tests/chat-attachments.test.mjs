import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	AttachmentValidationError,
	MAX_ATTACHMENT_MESSAGE_BYTES,
	validateAttachmentBatch,
	validateAttachmentInput,
} from "../src/lib/chat-attachment-types.ts";

test("accepts each supported attachment family", () => {
	const files = [
		["photo.png", "image/png", 1200],
		["scan.JPG", "image/jpeg", 2400],
		["notes.md", "text/markdown", 800],
		["study.pdf", "application/pdf", 3000],
		["data.json", "application/json", 500],
	];
	const result = validateAttachmentBatch(
		files.map(([filename, mediaType, size]) => ({ filename, mediaType, size })),
	);
	assert.equal(result.length, 5);
});

test("infers a missing MIME type from an allowed extension", () => {
	assert.equal(
		validateAttachmentInput({ filename: "verses.csv", mediaType: "", size: 100 }).mediaType,
		"text/csv",
	);
});

test("rejects extension and declared MIME mismatches", () => {
	assert.throws(
		() => validateAttachmentInput({ filename: "payload.json", mediaType: "image/png", size: 100 }),
		AttachmentValidationError,
	);
});

test("rejects more than five files", () => {
	assert.throws(
		() => validateAttachmentBatch(
			Array.from({ length: 6 }, (_, index) => ({
				filename: `file-${index}.txt`, mediaType: "text/plain", size: 10,
			})),
		),
		/up to 5 files/,
	);
});

test("rejects per-file and aggregate limits", () => {
	assert.throws(
		() => validateAttachmentInput({ filename: "huge.txt", mediaType: "text/plain", size: 1024 * 1024 + 1 }),
		/1 MB/,
	);
	assert.throws(
		() => validateAttachmentBatch([
			{ filename: "one.pdf", mediaType: "application/pdf", size: 10 * 1024 * 1024 },
			{ filename: "two.pdf", mediaType: "application/pdf", size: 10 * 1024 * 1024 },
			{ filename: "three.pdf", mediaType: "application/pdf", size: 6 * 1024 * 1024 },
		]),
		/25 MB/,
	);
	assert.equal(MAX_ATTACHMENT_MESSAGE_BYTES, 25 * 1024 * 1024);
});

test("web chat submits a file-only draft", async () => {
	const source = await readFile(new URL("../src/components/ChatInput.tsx", import.meta.url), "utf8");
	assert.match(
		source,
		/!trimmed && !attachment && fileAttachments\.length === 0/,
		"the submit guard must not reject a draft that contains only file attachments",
	);
});
