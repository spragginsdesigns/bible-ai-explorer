import { canonicalJSON, digest, SUPPORTED_TOOLS, KNOWN_INERT_READ_TOOLS, FIXED_NOTICES } from './projection.mjs';

// Opaque process-local tickets cannot be recreated from HTTP JSON or metadata.
const preparations = new WeakMap();
const approvals = new WeakMap();
const actionTools = new Set([...SUPPORTED_TOOLS,...KNOWN_INERT_READ_TOOLS].filter(name=>!['presentChoices','showInApp'].includes(name)));
const noteTools=new Set(['addToNote','updateNote','organizeNote']);
export function genericNoteOutput(tool,output){
    if(!noteTools.has(tool)||!output||typeof output!=='object'||typeof output.noteId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(output.noteId)||output.success===false||output.error)return null;
    return {...JSON.parse(canonicalJSON(output)),[tool==='organizeNote'?'title':'noteTitle']:'Saved note'};
}
export function fixedNoteReceiptParts(executions){
    return executions.flatMap(event=>{
        const output=event.success===true?genericNoteOutput(event.tool,event.output):null;
        return output?[{type:'tool-'+event.tool,toolCallId:event.toolCallId,state:'output-available',input:{},output}]:[];
    });
}
export function isFixedNoteReceiptFallback(source,manifest){
    if(!Object.values(FIXED_NOTICES).includes(source.row.content)||!Array.isArray(manifest)||!manifest.length)return false;
    const metadata=source.row.metadata??{};
    if(Object.keys(metadata).some(key=>!['parts','translation'].includes(key)))return false;
    const parts=metadata.parts??[],text=parts.filter(part=>part.type==='text'),tools=parts.filter(part=>part.type!=='text');
    if(text.length!==1||text[0].text!==source.row.content||tools.length!==manifest.length)return false;
    return tools.every(part=>manifest.some(event=>part.type==='tool-'+event.tool&&part.toolCallId===event.toolCallId&&part.state==='output-available'&&digest(part.output)===digest(genericNoteOutput(event.tool,event.output))));
}
export function freshActionManifest(source, executions) {
    if (!Array.isArray(executions) || executions.length > 96) throw new Error('Fresh executions are incomplete');
    const parts = source.row.metadata?.parts ?? [];
    const required = parts.filter(part => part?.type?.startsWith('tool-') && actionTools.has(part.type.slice(5)) && part.state === 'output-available' && part.output?.success !== false && !part.output?.error);
    const keys = new Set();
    const manifest = [];
    for (const part of required) {
        const tool = part.type.slice(5);
        const matching = executions.filter(event => event.tool === tool && event.toolCallId === part.toolCallId && event.success === true && (digest(event.output) === digest(part.output)||(Object.values(FIXED_NOTICES).includes(source.row.content)&&genericNoteOutput(tool,event.output)&&digest(genericNoteOutput(tool,event.output))===digest(part.output))));
        const key = tool + ':' + part.toolCallId;
        if (matching.length !== 1 || keys.has(key)) throw new Error('Fresh operation evidence does not match its exact result');
        keys.add(key);
        manifest.push({tool, toolCallId: part.toolCallId, outputDigest: digest(matching[0].output), displayOutputDigest:digest(part.output), output: JSON.parse(canonicalJSON(matching[0].output))});
    }
    return manifest;
}
export function recoveredFreshActions(record, source, requiredActions) {
    const evidence = record?.freshEvidence;
    if (!evidence || evidence.version !== 1 || !record.actionProofPassed || evidence.sourceDigest !== digest(source) || digest(record.sourceSnapshot) !== digest(source)) return null;
    if(record.state==='notice'){if(!isFixedNoteReceiptFallback(source,evidence.actions))return null;}
    else if(record.state!=='verified'||!record.canonicalPassed||!record.semanticPassed)return null;
    if (!Array.isArray(evidence.actions) || evidence.actions.length > 96) return null;
    const parts = source.row.metadata?.parts ?? [];
    for (const action of evidence.actions) {
        const matching = parts.filter(part => part.type === 'tool-' + action.tool && part.toolCallId === action.toolCallId && part.state === 'output-available' && digest(part.output) === action.displayOutputDigest);
        if (matching.length !== 1 || digest(action.output)!==action.outputDigest) return null;
    }
    if (requiredActions.some(action => !evidence.actions.some(proof => proof.tool === action.tool && proof.toolCallId === action.toolCallId))) return null;
    return evidence.actions;
}
export function createFreshPreparation(data) {
    const ticket = Object.freeze({});
    preparations.set(ticket, data);
    return {ticket, blocks: data.built.review.blocks.map(block => ({id: block.path, text: block.text})), question: data.built.context.question, context: data.built.reviewContext, sourceDigest: data.built.binding.sourceDigest, noticeOnly: data.noticeOnly};
}
export const readFreshPreparation = ticket => preparations.get(ticket) ?? null;
/** Only a successful gate over every final display field can approve a ticket. */
export function createFreshHistoryProof(ticket, checked) {
    const data = preparations.get(ticket);
    if (!data) throw new Error('Unknown fresh preparation');
    const expected = data.built.review.blocks.map(block => ({id: block.path, text: block.text}));
    if (!data.noticeOnly || checked !== null) {
        if (!checked?.verified || !checked.canonicalPassed || !checked.semanticPassed || checked.issueCodes?.length || checked.reviewerModelId !== data.built.policy.reviewerModelId) throw new Error('Fresh final envelope was not verified');
        if (canonicalJSON(checked.blocks) !== canonicalJSON(expected)) throw new Error('Fresh gate changed or omitted a final display field');
    }
    const proof = Object.freeze({});
    approvals.set(proof, data);
    preparations.delete(ticket);
    return proof;
}
export const readFreshHistoryProof = proof => approvals.get(proof) ?? null;
