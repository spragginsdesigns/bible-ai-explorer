import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { joinAssistantTextParts, stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import { persistableParts } from "@/lib/ai/status-narration";
import { VERIFICATION_UNAVAILABLE } from "@/lib/ai/verified-generation";
import type { AnswerLanguage, TranslationId } from "@/lib/bible/translations";
import type { ExecutedHistoryAction, FreshHistoryDraft, HistoryLocator, HistoryService, HistoryStateResponse } from "./contracts";
import { createFreshHistoryProof, fixedNoteReceiptParts } from "./fresh-proof.mjs";

/** Hydrate the exact buffered SDK envelope before any answer chunks are released. */
async function hydrate(chunks: UIMessageChunk[], messageId: string): Promise<UIMessage> {
	let final: UIMessage | undefined;
	const stream = new ReadableStream<UIMessageChunk>({ start(controller) {
		controller.enqueue({type:"start",messageId});
		for (const chunk of chunks) if (chunk.type !== "start" && chunk.type !== "finish" && chunk.type !== "data-status") controller.enqueue(chunk);
		controller.enqueue({type:"finish"});
		controller.close();
	} });
	for await (const message of readUIMessageStream({stream,terminateOnError:true})) final = message;
	if (!final || final.id !== messageId || final.role !== "assistant") throw new Error("Final assistant envelope could not be hydrated");
	return final;
}

/** Publish normalized body once; actual current-run effect payloads stay intact. */
function release(chunks: UIMessageChunk[], saved: HistoryStateResponse, write: (chunk: UIMessageChunk) => void): void {
	const followUps = saved.row.metadata.followUps;
	const suffix = Array.isArray(followUps) ? followUps.filter((value): value is string => typeof value === "string").map(value=>`\n[FOLLOWUP] ${value}`).join("") : "";
	const body = saved.row.content + suffix;
	let emitted = false;
	for (const chunk of chunks) {
		if (chunk.type === "start" || chunk.type === "finish" || chunk.type === "data-status") continue;
		if (chunk.type === "text-start") {
			if (!emitted) { emitted=true;write(chunk);write({type:"text-delta",id:chunk.id,delta:body});write({type:"text-end",id:chunk.id}); }
			continue;
		}
		if (chunk.type === "text-delta" || chunk.type === "text-end") continue;
		write(chunk);
	}
	if (!emitted && body.trim()) {
		write({type:"text-start",id:"certified-answer"});
		write({type:"text-delta",id:"certified-answer",delta:body});
		write({type:"text-end",id:"certified-answer"});
	}
}

/** One bounded final review, then atomic source/sidecar commit, then output. */
export async function releaseCertifiedFreshTurn(options: {
	ownerId:string; locator:HistoryLocator; chunks:UIMessageChunk[]; translation:TranslationId;
	language?:AnswerLanguage; metadata?:Record<string,unknown>; actions:ExecutedHistoryAction[];
	operation?:FreshHistoryDraft["operation"]; service:HistoryService;
	preparedRequest?:object;
	write:(chunk:UIMessageChunk)=>void; signal?:AbortSignal;
}):Promise<{message:UIMessage;saved:HistoryStateResponse;fallback:boolean}> {
	// Operational progress is excluded consistently from the final live and
	// stored envelope. Fixed status heartbeats remain the transport wait signal.
	const names=new Map<string,string>();
	for(const chunk of options.chunks)if(chunk.type==="tool-input-available")names.set(chunk.toolCallId,chunk.toolName);
	const chunks=options.chunks.filter(chunk=>chunk.type!=="data-progress"&&chunk.type!=="data-status").map(chunk=>{
		if(chunk.type!=="tool-output-available")return chunk;
		const name=names.get(chunk.toolCallId);
		// Receipt facts describe the tool result that actually committed. A
		// failed first prose gate may blank a label, but cannot undo that result.
		// The final envelope review checks these exact truthful receipt labels.
		const actual=options.actions.find(action=>action.toolCallId===chunk.toolCallId&&action.tool===name);
		return actual&&!['presentChoices','showInApp'].includes(name??'')?{...chunk,output:structuredClone(actual.output)}:chunk;
	});
	const message = await hydrate(chunks,options.locator.messageId);
	const text = joinAssistantTextParts(message.parts.filter(part=>part.type==="text").map(part=>part.text)).trim();
	const content = stripFollowUpMarkers(text,{streaming:false}).trim();
	const draft:FreshHistoryDraft={content,metadata:{...options.metadata,parts:JSON.parse(JSON.stringify(persistableParts(message.parts))),translation:options.translation},actions:options.actions,...(options.preparedRequest?{preparedRequest:options.preparedRequest}:{}),...(options.operation?{operation:options.operation}:{})};
	let committed=false;
	try {
		options.signal?.throwIfAborted();
		const prepared=await options.service.prepareFresh(options.ownerId,options.locator,draft);
		const checked=prepared.noticeOnly?null:await options.service.reviewFresh(prepared,{signal:options.signal});
		const proof=createFreshHistoryProof(prepared.ticket,checked);
		const saved=await options.service.certifyFresh(options.ownerId,options.locator,proof);
		committed=true;
		release(chunks,saved,options.write);
		return {message,saved,fallback:false};
	} catch {
		if(committed)throw new Error("The certified answer was saved but its transport ended");
		// No unchecked answer/card is replayed after a final-review failure.
		// This literal has no claim about whether an earlier tool succeeded.
		const text=VERIFICATION_UNAVAILABLE[options.language??"en"];
		const fallbackChunks:UIMessageChunk[]=[{type:"text-start",id:"verified-answer"},{type:"text-delta",id:"verified-answer",delta:text},{type:"text-end",id:"verified-answer"}];
		for(const part of fixedNoteReceiptParts(options.actions)){
			fallbackChunks.push({type:"tool-input-available",toolCallId:part.toolCallId,toolName:part.type.slice(5),input:{}});
			fallbackChunks.push({type:"tool-output-available",toolCallId:part.toolCallId,output:part.output});
		}
		const fallbackMessage=await hydrate(fallbackChunks,options.locator.messageId);
		const prepared=await options.service.prepareFresh(options.ownerId,options.locator,{content:text,metadata:{parts:JSON.parse(JSON.stringify(persistableParts(fallbackMessage.parts))),translation:options.translation},actions:options.actions,recovery:{content:draft.content,metadata:draft.metadata},...(options.operation?{operation:options.operation}:{})});
		if (!prepared.noticeOnly) throw new Error("Fixed failure notice did not match its exact safe contract");
		const saved=await options.service.certifyFresh(options.ownerId,options.locator,createFreshHistoryProof(prepared.ticket,null));
		release(fallbackChunks,saved,options.write);
		return {message:fallbackMessage,saved,fallback:true};
	}
}

/** A refused complete request never starts inference or executes any tool. */
export async function releaseFreshRequestRefusal(options:Omit<Parameters<typeof releaseCertifiedFreshTurn>[0],"chunks"|"preparedRequest"|"actions">){
	const text=VERIFICATION_UNAVAILABLE[options.language??"en"];
	return releaseCertifiedFreshTurn({...options,actions:[],chunks:[{type:"text-start",id:"request-withheld"},{type:"text-delta",id:"request-withheld",delta:text},{type:"text-end",id:"request-withheld"}]});
}
