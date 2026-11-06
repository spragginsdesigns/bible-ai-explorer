import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { joinAssistantTextParts, stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import { persistableParts } from "@/lib/ai/status-narration";
import { VERIFICATION_UNAVAILABLE } from "@/lib/ai/verified-generation";
import type { AnswerLanguage, TranslationId } from "@/lib/bible/translations";
import type { ExecutedHistoryAction, FreshHistoryDraft, HistoryLocator, HistoryService, HistoryStateResponse, HistoryVerificationResult } from "./contracts";
import { createFreshHistoryProof, fixedNoteReceiptParts } from "./fresh-proof.mjs";
import { HistoryError } from "./service.mjs";
import { traceTurn, classifyTurnError, type TurnTraceFields } from "@/lib/ai/turn-trace";

type CertificationStage = "prepare" | "review" | "revise" | "hydrate-revision" | "proof" | "certify" | "release";
const traceStages = {prepare:"certification-prepare",review:"certification-review",revise:"certification-revision","hydrate-revision":"certification-revision-hydrate",proof:"certification-proof",certify:"certification-commit",release:"certification-release"} as const;

/** Diagnostics must never decide whether a checked answer can be released. */
function logCertificationEvent(event: "[final-review]" | "[final-certification-failure]", data: Record<string, unknown>): void {
	try { console.info(event, JSON.stringify(data)); } catch { /* Telemetry is best effort. */ }
}

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

/** The answer's prose blocks, in order, as the pre-display gate saw them. */
export function textBlocksOf(chunks: readonly UIMessageChunk[]): {id: string; text: string}[] {
	const order: string[] = [];
	const text = new Map<string, string>();
	for (const chunk of chunks) {
		if (chunk.type === "text-start" && !text.has(chunk.id)) { text.set(chunk.id, ""); order.push(chunk.id); }
		else if (chunk.type === "text-delta") text.set(chunk.id, (text.get(chunk.id) ?? "") + chunk.delta);
	}
	return order.map(id => ({id, text: text.get(id) ?? ""}));
}

/** The same envelope with only its prose replaced; tools, cards and order are untouched. */
export function withTextBlocks(chunks: readonly UIMessageChunk[], blocks: readonly {id: string; text: string}[]): UIMessageChunk[] {
	const byId = new Map(blocks.map(block => [block.id, block.text]));
	const written = new Set<string>();
	const out: UIMessageChunk[] = [];
	for (const chunk of chunks) {
		if (chunk.type === "text-delta") continue;
		out.push(chunk);
		if (chunk.type === "text-start" && !written.has(chunk.id)) {
			written.add(chunk.id);
			out.push({type: "text-delta", id: chunk.id, delta: byId.get(chunk.id) ?? ""});
		}
	}
	return out;
}

/** Rounds of repair after a clean final-review rejection, before the fixed notice. */
export const FINAL_REVIEW_REVISIONS = 2;

/** One bounded final review, then atomic source/sidecar commit, then output. */
export async function releaseCertifiedFreshTurn(options: {
	ownerId:string; locator:HistoryLocator; chunks:UIMessageChunk[]; translation:TranslationId;
	language?:AnswerLanguage; metadata?:Record<string,unknown>; actions:ExecutedHistoryAction[];
	operation?:FreshHistoryDraft["operation"]; service:HistoryService;
	preparedRequest?:object;
	write:(chunk:UIMessageChunk)=>void; signal?:AbortSignal;
	/**
	 * Repair the prose after the final review rejected it, using that review's
	 * findings. Returns the revised envelope only once it passed the full
	 * pre-display gate again, else null. The revision still faces this same
	 * final review: nothing reaches the reader or history unverified.
	 */
	revise?:(chunks:UIMessageChunk[],review:NonNullable<HistoryVerificationResult["review"]>)=>Promise<UIMessageChunk[]|null>;
}):Promise<{message:UIMessage;saved:HistoryStateResponse;fallback:boolean;failureClassification?:ReturnType<typeof classifyTurnError>&{stage:CertificationStage;code:string}}> {
	// Operational progress is excluded consistently from the final live and
	// stored envelope. Fixed status heartbeats remain the transport wait signal.
	const names=new Map<string,string>();
	for(const chunk of options.chunks)if(chunk.type==="tool-input-available")names.set(chunk.toolCallId,chunk.toolName);
	let chunks=options.chunks.filter(chunk=>chunk.type!=="data-progress"&&chunk.type!=="data-status").map(chunk=>{
		if(chunk.type!=="tool-output-available")return chunk;
		const name=names.get(chunk.toolCallId);
		// Receipt facts describe the tool result that actually committed. A
		// failed first prose gate may blank a label, but cannot undo that result.
		// The final envelope review checks these exact truthful receipt labels.
		const actual=options.actions.find(action=>action.toolCallId===chunk.toolCallId&&action.tool===name);
		return actual&&!['presentChoices','showInApp'].includes(name??'')?{...chunk,output:structuredClone(actual.output)}:chunk;
	});
	const draftOf=async(envelope:UIMessageChunk[])=>{
		const message = await hydrate(envelope,options.locator.messageId);
		const text = joinAssistantTextParts(message.parts.filter(part=>part.type==="text").map(part=>part.text)).trim();
		const content = stripFollowUpMarkers(text,{streaming:false}).trim();
		const draft:FreshHistoryDraft={content,metadata:{...options.metadata,parts:JSON.parse(JSON.stringify(persistableParts(message.parts))),translation:options.translation},actions:options.actions,...(options.preparedRequest?{preparedRequest:options.preparedRequest}:{}),...(options.operation?{operation:options.operation}:{})};
		return {message,draft};
	};
	let {message,draft}=await draftOf(chunks);
	let committed=false;
	let stage:CertificationStage="prepare",round=0;
	const startedAt=Date.now();
	const emitStage=(current:CertificationStage,phase:"started"|"completed"|"failed",fields:()=>TurnTraceFields,error?:unknown)=>{
		try {
			traceTurn(traceStages[current],phase,{round,chunkCount:chunks.length,textBlockCount:chunks.filter(chunk=>chunk.type==="text-start").length,actionCount:options.actions.length,inputChars:draft.content.length,...fields(),...(phase==="failed"?classifyTurnError(error):{})});
		} catch { /* Tracing cannot change verification or transport behavior. */ }
	};
	const atStage=async<T>(current:CertificationStage,run:()=>T|Promise<T>,fields:TurnTraceFields={},completed?:(result:T)=>TurnTraceFields):Promise<T>=>{
		stage=current;
		const began=Date.now();
		emitStage(current,"started",()=>fields);
		try {
			const result=await run();
			emitStage(current,"completed",()=>({...fields,durationMs:Math.max(0,Date.now()-began),...completed?.(result)}));
			return result;
		} catch(error) {
			emitStage(current,"failed",()=>({...fields,durationMs:Math.max(0,Date.now()-began)}),error);
			throw error;
		}
	};
	try {
		let prepared:Awaited<ReturnType<HistoryService["prepareFresh"]>>;
		let checked:HistoryVerificationResult|null;
		for(;;round++){
			prepared=await atStage("prepare",()=>{
				options.signal?.throwIfAborted();
				return options.service.prepareFresh(options.ownerId,options.locator,draft);
			});
			checked=await atStage("review",()=>prepared.noticeOnly?null:options.service.reviewFresh(prepared,{signal:options.signal}),{},result=>({issueCount:result?.review?.issues.length??0,reason:result===null?"skipped":result.verified?"approved":"review-rejected"}));
			const rejected=checked!==null&&!checked.verified;
			// Content-free: counts and outcomes only, never findings or prose.
			logCertificationEvent("[final-review]",{round,verified:checked?.verified??null,noticeOnly:prepared.noticeOnly,findings:checked?.review?.issues.length??null});
			if(!rejected||!checked?.review||!options.revise||round>=FINAL_REVIEW_REVISIONS)break;
			let revised:UIMessageChunk[]|null=null;
			const revise=options.revise,review=checked.review;
			try{revised=await atStage("revise",()=>revise(chunks,review),{issueCount:review.issues.length},result=>({reason:result?"approved":"withheld"}));}catch{revised=null;}
			logCertificationEvent("[final-review]",{round,revision:revised?"passed-pre-display":"failed"});
			if(!revised)break;
			chunks=revised;
			({message,draft}=await atStage("hydrate-revision",()=>draftOf(chunks)));
		}
		const proof=await atStage("proof",()=>createFreshHistoryProof(prepared.ticket,checked));
		const saved=await atStage("certify",()=>options.service.certifyFresh(options.ownerId,options.locator,proof),{},()=>({certified:true,persisted:true}));
		committed=true;
		await atStage("release",()=>release(chunks,saved,options.write),{certified:true,persisted:true,outputChars:saved.row.content.length});
		return {message,saved,fallback:false};
	} catch (error) {
		// Only the service's normalized enum is safe. Arbitrary provider codes,
		// messages, findings and request identifiers must never reach telemetry.
		let code="verification_unavailable";
		try { if(error instanceof HistoryError)code=new HistoryError(error.code).code; } catch { /* Untrusted error properties stay unavailable. */ }
		let classification:ReturnType<typeof classifyTurnError>={errorClass:"Error"};
		try { classification=classifyTurnError(error); } catch { /* Keep the closed safe default when telemetry fails. */ }
		const failureClassification={...classification,stage,code};
		logCertificationEvent("[final-certification-failure]",{stage,round,elapsedMs:Math.max(0,Date.now()-startedAt),code});
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
		const fallbackFields={fallback:true,chunkCount:fallbackChunks.length,textBlockCount:1,inputChars:text.length};
		const prepared=await atStage("prepare",()=>options.service.prepareFresh(options.ownerId,options.locator,{content:text,metadata:{parts:JSON.parse(JSON.stringify(persistableParts(fallbackMessage.parts))),translation:options.translation},actions:options.actions,recovery:{content:draft.content,metadata:draft.metadata},...(options.operation?{operation:options.operation}:{})}),fallbackFields);
		const proof=await atStage("proof",()=>{
			if (!prepared.noticeOnly) throw new Error("Fixed failure notice did not match its exact safe contract");
			return createFreshHistoryProof(prepared.ticket,null);
		},fallbackFields);
		const saved=await atStage("certify",()=>options.service.certifyFresh(options.ownerId,options.locator,proof),fallbackFields,()=>({certified:true,persisted:true}));
		await atStage("release",()=>release(fallbackChunks,saved,options.write),{...fallbackFields,certified:true,persisted:true,outputChars:saved.row.content.length});
		return {message:fallbackMessage,saved,fallback:true,failureClassification};
	}
}

/** A refused complete request never starts inference or executes any tool. */
export async function releaseFreshRequestRefusal(options:Omit<Parameters<typeof releaseCertifiedFreshTurn>[0],"chunks"|"preparedRequest"|"actions">){
	const text=VERIFICATION_UNAVAILABLE[options.language??"en"];
	return releaseCertifiedFreshTurn({...options,actions:[],chunks:[{type:"text-start",id:"request-withheld"},{type:"text-delta",id:"request-withheld",delta:text},{type:"text-end",id:"request-withheld"}]});
}
