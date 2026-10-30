import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptCanonicalDocument, type CanonicalAdoptionMessage } from "./canonicalAdoptionProtocol";
const mocks = vi.hoisted(() => ({ configs: [] as unknown[] }));
vi.mock("@10play/tentap-editor", () => ({ BridgeExtension: class { constructor(config: unknown) { mocks.configs.push(config); } } }));
import { createCanonicalAdoptionBridge } from "./components/canonicalAdoptionBridge";
const text = { type: "text", text: "The same text" };
const doc = (node = { type: "paragraph", content: [text] } as object) => ({ type: "doc", content: [node] });
afterEach(() => { vi.useRealTimers(); mocks.configs.length = 0; });
describe("atomic canonical note adoption", () => {
	it("rejects stale formatting even when all plain text is identical", () => {
		const expected = doc({ type: "paragraph", content: [{ ...text, marks: [{ type: "bold" }] }] });
		const html = vi.fn(() => "<p>The same text</p>");
		expect(adoptCanonicalDocument(expected, () => {}, () => doc(), html)).toEqual({ matched: false });
		expect(html).not.toHaveBeenCalled();
	});
	it("rejects different node structure and link attributes with identical text", () => {
		expect(adoptCanonicalDocument(doc({ type: "heading", attrs: { level: 2 }, content: [text] }), () => {}, () => doc(), () => "html").matched).toBe(false);
		const expected = doc({ type: "paragraph", content: [{ ...text, marks: [{ type: "link", attrs: { href: "https://sureword.app/one" } }] }] });
		const other = doc({ type: "paragraph", content: [{ ...text, marks: [{ type: "link", attrs: { href: "https://sureword.app/two" } }] }] });
		expect(adoptCanonicalDocument(expected, () => {}, () => other, () => "html").matched).toBe(false);
	});
	it("applies and compares all structure before acknowledging its normalized HTML", () => {
		let actual = doc();
		const expected = doc({ type: "paragraph", content: [{ ...text, marks: [{ type: "italic" }] }] });
		const normalized = "<p><em>The same text</em></p>";
		const result = adoptCanonicalDocument(expected, () => { actual = JSON.parse(JSON.stringify(expected)); }, () => actual, () => normalized);
		expect(result).toEqual({ matched: true, html: normalized });
	});
	it("ignores JSON object key order without ignoring ordered nodes or marks", () => {
		const expected = { type: "doc", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] };
		expect(adoptCanonicalDocument(expected, () => {}, () => ({ content: [{ text: "a", type: "text" }, { text: "b", type: "text" }], type: "doc" }), () => "ab").matched).toBe(true);
		expect(adoptCanonicalDocument(expected, () => {}, () => ({ type: "doc", content: [...expected.content].reverse() }), () => "ba").matched).toBe(false);
	});
	it("requires the matching request acknowledgment, not an unrelated HTML response", async () => {
		const channel = createCanonicalAdoptionBridge();
		const config = mocks.configs[0] as { onEditorMessage: (message: CanonicalAdoptionMessage) => boolean; extendEditorInstance: (send: (message: CanonicalAdoptionMessage) => void) => { replaceCanonicalNote: (html: string) => Promise<unknown> } };
		const sent: CanonicalAdoptionMessage[] = [];
		const native = config.extendEditorInstance(message => sent.push(message));
		const pending = native.replaceCanonicalNote("<p>canonical</p>"); let completed = false; void pending.then(() => { completed = true; });
		config.onEditorMessage({ type: "canonical-note-replaced", payload: { requestId: "wrong", matched: true, html: "<p>stale</p>" } });
		await Promise.resolve(); expect(completed).toBe(false);
		config.onEditorMessage({ type: "canonical-note-replaced", payload: { requestId: sent[0].payload.requestId, matched: true, html: "<p>canonical</p>" } });
		expect(await pending).toEqual({ matched: true, html: "<p>canonical</p>" }); channel.dispose();
	});
	it("fails closed when the bridge acknowledgment times out", async () => {
		vi.useFakeTimers(); const channel = createCanonicalAdoptionBridge();
		const config = mocks.configs[0] as { extendEditorInstance: (send: () => void) => { replaceCanonicalNote: (html: string) => Promise<unknown> } };
		const pending = config.extendEditorInstance(() => {}).replaceCanonicalNote("<p>canonical</p>");
		await vi.advanceTimersByTimeAsync(1200); expect(await pending).toEqual({ matched: false }); channel.dispose();
	});
	it("disposal rejects a held adoption and its old acknowledgment cannot complete a successor bridge", async () => {
		const old = createCanonicalAdoptionBridge();
		type Config = { onEditorMessage: (message: CanonicalAdoptionMessage) => boolean; extendEditorInstance: (send: (message: CanonicalAdoptionMessage) => void) => { replaceCanonicalNote: (html: string) => Promise<unknown> } };
		const oldConfig = mocks.configs[0] as Config, sent: CanonicalAdoptionMessage[] = [];
		const oldPending = oldConfig.extendEditorInstance(message => sent.push(message)).replaceCanonicalNote("<p>old session</p>");
		old.dispose(); expect(await oldPending).toEqual({ matched: false });
		const next = createCanonicalAdoptionBridge(), nextConfig = mocks.configs[1] as Config;
		const nextPending = nextConfig.extendEditorInstance(message => sent.push(message)).replaceCanonicalNote("<p>new session</p>");
		let completed = false; void nextPending.then(() => { completed = true; });
		nextConfig.onEditorMessage({ type: "canonical-note-replaced", payload: { requestId: sent[0].payload.requestId, matched: true, html: "<p>old session</p>" } });
		await Promise.resolve(); expect(completed).toBe(false);
		nextConfig.onEditorMessage({ type: "canonical-note-replaced", payload: { requestId: sent[1].payload.requestId, matched: true, html: "<p>new session</p>" } });
		expect(await nextPending).toEqual({ matched: true, html: "<p>new session</p>" }); next.dispose();
	});

});
