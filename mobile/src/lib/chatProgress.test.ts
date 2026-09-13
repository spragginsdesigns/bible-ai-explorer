import { describe, expect, it } from "vitest";
import { toViewMessage, dbMessageToUIMessage } from "./chatView";
import { formatWorkDuration } from "./chatProgress";

const data = { version: 1, runId: "run", sequence: 4, elapsedMs: 62000, lastActivityMs: 60000,
 state: "complete", phase: "answering", label: "Work completed", entries: [{ id: "tool", kind: "tool", state: "complete", label: "Read John 2:1–11" }] };

describe("work history", () => {
 it("restores completed activity without showing a running status", () => {
  const message = dbMessageToUIMessage({ id:"a", role:"assistant", content:"Answer", metadata:{ parts:[{ type:"data-progress",id:"progress",data },{type:"text",text:"Answer"}] } });
  const view = toViewMessage(message, { isStreaming: false });
  expect(view.progress?.entries[0].label).toBe("Read John 2:1–11");
  expect(view.activity).toBeUndefined();
  expect(formatWorkDuration(view.progress!.elapsedMs)).toBe("1m 2s");
 });
 it("keeps new progress visible after a preamble and ignores legacy generic tool copy", () => {
  const message = { id:"a", role:"assistant", parts:[{type:"text",text:"Let me check."},{type:"data-progress",id:"progress",data:{...data,state:"running",phase:"tool",label:"Opening John 2:1–11"}},{type:"tool-getPassage",state:"input-available",toolCallId:"tool"}] };
  const view = toViewMessage(message as never,{isStreaming:true});
  expect(view.activity).toBe("Opening John 2:1–11");
  expect(view.progress).toBeDefined();
 });
 it("retains interrupted work history for the UI to distinguish it from completion", () => {
  const view = toViewMessage({ id:"a",role:"assistant",parts:[{type:"data-progress",id:"progress",data:{...data,state:"error"}}]} as never,{isStreaming:false});
  expect(view.progress?.state).toBe("error");
 });
});
