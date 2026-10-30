import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NoteAIOperationController } from "./noteAIOperation";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), send: vi.fn(), token: vi.fn(async () => "token"), transport: null as { fetch: (input: string, init: { body: string }) => Promise<Response> } | null, stop: vi.fn(), history: vi.fn(async () => []) }));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", Modal: "Modal", ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView", StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } }));
vi.mock("@/components/AppText", () => ({ AppText: "Text", AppTextInput: "TextInput" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/theme", () => ({ radius: {}, spacing: {}, typography: {} }));
vi.mock("@/features/settings/settingsStore", () => ({ useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) }));
vi.mock("@/features/chat/slashCommands", () => ({ NOTE_SLASH_COMMANDS: [], matchSlashCommands: () => [], parseSlashCommand: () => null }));
vi.mock("@/features/chat/ErrorCard", () => ({ ErrorCard: () => null }));
vi.mock("./components/NoteAIMessage", () => ({ NoteAIMessage: () => null }));
vi.mock("./components/primitives", () => ({ GlyphButton: () => null, LUCIDE_STROKE: 1 }));
vi.mock("lucide-react-native/icons/chevron-down", () => ({ default: () => null }));
vi.mock("lucide-react-native/icons/sparkles", () => ({ default: () => null }));
vi.mock("lucide-react-native/icons/trash", () => ({ default: () => null }));
vi.mock("./useStableGetToken", () => ({ useStableGetToken: () => mocks.token }));
vi.mock("./api", () => ({ fetchNoteAIMessages: mocks.history, clearNoteAIMessages: vi.fn(async () => {}) }));
vi.mock("@/lib/api", () => ({ API_URL: "https://sureword.app", makeAuthedFetch: () => mocks.fetch }));
vi.mock("@/lib/chatView", () => ({ dbMessageToUIMessage: (value: unknown) => value, isRenderableChatViewMessage: () => true, streamingAssistantId: () => undefined, toViewMessage: (value: unknown) => value }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("ai", () => ({ DefaultChatTransport: class { constructor(options: typeof mocks.transport) { mocks.transport = options; } } }));
vi.mock("@ai-sdk/react", () => ({ useChat: () => { const [messages, setMessages] = React.useState([]); return { messages, setMessages, sendMessage: mocks.send, stop: mocks.stop, clearError: mocks.stop, status: "ready", error: null }; } }));
import { useNoteAI } from "./useNoteAI";
import { NoteAIPanel } from "./components/NoteAIPanel";
let root: ReturnType<typeof create> | null = null;
function controller(editable = true) {
 return { canEdit: () => editable, isCurrent: () => true, begin: vi.fn(async (body: Record<string, unknown>) => ({ ...body, noteId: "note-one", operationId: "00000000-0000-4000-8000-000000000002" })), recover: vi.fn(async () => true) } as unknown as NoteAIOperationController;
}
const panel = (operation: NoteAIOperationController) => React.createElement(NoteAIPanel, { noteId: "note-one", operation, visible: true, onClose: async () => true, beforeNavigate: async () => true, onNavigated() {} });
const input = () => root!.root.findByType("TextInput" as React.ElementType);
const send = () => root!.root.findAllByType("Pressable" as React.ElementType).find(button => button.props.accessibilityLabel === "Send")!;
beforeEach(() => {
 Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
 mocks.fetch.mockReset(); mocks.fetch.mockResolvedValue(new Response("accepted", { status: 200 })); mocks.send.mockReset(); mocks.stop.mockClear(); mocks.history.mockClear();
 mocks.send.mockImplementation(async message => { await mocks.transport!.fetch("https://sureword.app/api/note-ai", { body: JSON.stringify({ messages: [message] }) }); });
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; });
for (const state of ["checking", "failed"]) it(`keeps the typed question when the operation is ${state}`, async () => {
 const owner = controller(false);
 await act(async () => { root = create(panel(owner)); });
 await act(async () => { input().props.onChangeText("Keep this unsent question"); });
 await act(async () => { await send().props.onPress(); });
 expect(input().props.value).toBe("Keep this unsent question"); expect(mocks.send).not.toHaveBeenCalled(); expect(owner.begin).not.toHaveBeenCalled();
});
it("keeps typed input after HTTP refusal and settles its reserved operation", async () => {
 const owner = controller(); mocks.fetch.mockResolvedValueOnce(new Response("not accepted", { status: 503 }));
 await act(async () => { root = create(panel(owner)); });
 await act(async () => { input().props.onChangeText("Question survives refusal"); });
 await act(async () => { await send().props.onPress(); });
 expect(input().props.value).toBe("Question survives refusal"); expect(owner.begin).toHaveBeenCalledOnce(); expect(owner.recover).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002");
});
it("clears only a question the server accepted for the same controller", async () => {
 const owner = controller();
 await act(async () => { root = create(panel(owner)); });
 await act(async () => { input().props.onChangeText("Accepted question"); });
 await act(async () => { await send().props.onPress(); });
 expect(input().props.value).toBe(""); expect(owner.begin).toHaveBeenCalledOnce(); expect(mocks.fetch).toHaveBeenCalledOnce();
});
it("an old delayed SDK send cannot reserve against a successor editor or same-user session", async () => {
 const old = controller(), next = controller(); let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 mocks.send.mockImplementation(async message => { await held; await mocks.transport!.fetch("https://sureword.app/api/note-ai", { body: JSON.stringify({ messages: [message] }) }); });
 let current!: ReturnType<typeof useNoteAI>;
 function Host({ owner }: { owner: NoteAIOperationController }) { current = useNoteAI("note-one", owner); return null; }
 await act(async () => { root = create(React.createElement(Host, { owner: old })); });
 let accepted!: Promise<boolean>; await act(async () => { accepted = current.sendMessage("belongs to original session"); });
 await act(async () => { root!.update(React.createElement(Host, { owner: next })); });
 await act(async () => { release(); expect(await accepted).toBe(false); });
 expect(old.begin).not.toHaveBeenCalled(); expect(next.begin).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});
