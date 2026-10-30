/** Server-only in-process current-request evidence; no HTTP JSON can mint a ticket. */
import {canonicalJSON,digest,historyAISourceRow} from './projection.mjs';
const tickets=new WeakMap();
const clone=value=>JSON.parse(canonicalJSON(value));
const isRecord=value=>value&&typeof value==='object'&&!Array.isArray(value);
const mediaURL=part=>{
    const data=part.type==='image'?part.image:part.data;
    if(typeof data==='string'||data instanceof URL)return String(data);
    return isRecord(data)&&data.type==='url'&&(typeof data.url==='string'||data.url instanceof URL)?String(data.url):null;
};
export function reviewerIdentity(definition){
    if(!definition?.id||!definition.provider||!definition.providerModelId||!definition.pricing)throw Error('A registered priced reviewer is required');
    return clone({id:definition.id,provider:definition.provider,providerModelId:definition.providerModelId,pricing:definition.pricing,supportsAttachments:definition.supportsAttachments===true});
}
export function attachmentIdentity(row){
    return {id:row.id,messageId:row.messageId,identityDigest:digest({id:row.id,userId:row.userId,messageId:row.messageId,pathname:row.pathname,filename:row.filename,mediaType:row.mediaType,size:row.size,etag:row.etag,status:row.status,transcript:row.transcript??null,durationSeconds:row.durationSeconds??null})};
}
export function preparedDependenciesMatch(descriptor,dependencies){
    try{
        if(descriptor?.version!==1||descriptor.scope!=='complete-server-prepared-request'||!Array.isArray(descriptor.rows)||descriptor.rows.length<1||descriptor.rows.length>24||!Array.isArray(descriptor.attachments)||descriptor.attachments.length>5||!['preparedDigest','systemDigest'].every(key=>/^[a-f0-9]{64}$/.test(descriptor[key])))return false;
        if(dependencies.rows.length!==descriptor.rows.length||dependencies.attachments.length!==descriptor.attachments.length)return false;
        if(descriptor.rows.some(expected=>{const row=dependencies.rows.find(row=>row.id===expected.id);return !row||row.role!==expected.role||digest(historyAISourceRow(row))!==expected.sourceDigest;}))return false;
        return descriptor.attachments.every(expected=>{const row=dependencies.attachments.find(row=>row.id===expected.id);return row&&row.status==='READY'&&typeof row.etag==='string'&&row.etag.length>0&&canonicalJSON(attachmentIdentity(row))===canonicalJSON(expected);});
    }catch{return false;}
}
export function createPreparedRequest(ownerId,locator,input,dependencies,identity){
    if(input.messages?.at(-1)?.role!=='user'||!Array.isArray(input.messages)||!input.messages.length||input.messages.length>24||!Array.isArray(input.sources)||input.sources.length!==input.messages.length||new Set(input.messages.map(row=>row.id)).size!==input.messages.length||typeof input.systemContext!=='string'||typeof input.review!=='function'||!Array.isArray(input.attachments)||input.attachments.length>5)throw Error('Incomplete prepared request');
    const rows=input.messages.map(message=>{
        const row=dependencies.rows.find(row=>row.id===message.id),expected=input.sources.find(source=>source.id===message.id);
        if(!row||!expected||!['user','assistant'].includes(message.role)||row.role!==message.role||expected.role!==message.role)throw Error('Prepared source ownership changed');
        if(message.role==='user'&&row.content!==expected.content)throw Error('Prepared user source changed');
        if(message.role==='assistant'&&digest(historyAISourceRow(row))!==digest(JSON.parse(JSON.stringify(historyAISourceRow(expected)))))throw Error('Prepared assistant source changed');
        return{id:row.id,role:row.role,sourceDigest:digest(historyAISourceRow(row))};
    });
    const selected=input.attachments.map(attachment=>{
        const row=dependencies.attachments.find(row=>row.id===attachment.id);
        if(!row||row.userId!==ownerId||row.status!=='READY'||typeof row.etag!=='string'||!row.etag||!rows.some(source=>source.id===row.messageId)||canonicalJSON(attachmentIdentity(row))!==canonicalJSON(attachmentIdentity(attachment)))throw Error('Prepared attachment ownership changed');
        return attachmentIdentity(row);
    });
    const media=[];
    const logical=input.messages.map(message=>({id:message.id,role:message.role,parts:message.parts.map(part=>{
        if(part.type!=='file')return clone(part);
        const attachment=input.attachments.find(row=>row.messageId===message.id&&row.previewUrl===part.url&&row.mediaType===part.mediaType&&row.filename===part.filename);
        if(!attachment)throw Error('Unowned prepared file');
        media.push(attachment);
        return{type:'file',attachmentId:attachment.id,mediaType:part.mediaType,filename:part.filename};
    })}));
    const parts=input.mediaParts??[];
    if(parts.length!==media.length||parts.some((part,index)=>!['file','image'].includes(part.type)||media[index].previewUrl!==mediaURL(part)||(part.type==='file'?part.mediaType!==media[index].mediaType:!media[index].mediaType.startsWith('image/'))||(part.filename!==undefined&&part.filename!==media[index].filename)))throw Error('Review media differs from owned prepared files');
    if(parts.length&&!identity.supportsAttachments)throw Error('Actual reviewer cannot read the prepared files');
    const descriptor={version:1,scope:'complete-server-prepared-request',rows,attachments:selected,preparedDigest:digest(logical),systemDigest:digest(input.systemContext),reviewer:clone(identity)};
    if(!preparedDependenciesMatch(descriptor,dependencies))throw Error('Incomplete prepared dependencies');
    const last=[...logical].reverse().find(row=>row.role==='user');
    const question=last?.parts.filter(part=>part.type==='text').map(part=>part.text).join('').trim()??'';
    if(question.length>16_000||canonicalJSON({messages:logical,systemContext:input.systemContext}).length>64_000)throw Error('Complete prepared request exceeds context bound');
    // Keep a distinct typed URL value; later SDK or caller mutation of its
    // input array cannot change the files the final reviewer is authorized to see.
    const stableMedia=parts.map(part=>part.type==='file'?{type:'file',mediaType:part.mediaType,...(part.filename?{filename:part.filename}:{}),data:{type:'url',url:new URL(mediaURL(part))}}:{type:'image',image:{type:'url',url:new URL(mediaURL(part))}});
    const data={ownerId,locator:{surface:locator.surface,parentId:locator.parentId,messageId:locator.messageId},descriptor,logical,systemContext:input.systemContext,question,mediaParts:stableMedia,review:input.review};
    const ticket=Object.freeze({});tickets.set(ticket,data);return ticket;
}
export const readPreparedRequest=ticket=>tickets.get(ticket)??null;
export function preparedReviewRecord(record,source){
    try{
        if(record?.state!=='verified'||!record.canonicalPassed||!record.semanticPassed||record.sourceDigest!==digest(source)||digest(record.sourceSnapshot)!==record.sourceDigest||record.freshEvidence?.version!==1||record.freshEvidence.sourceDigest!==record.sourceDigest||record.freshEvidence.prepared?.reviewer?.id!==record.reviewerModelId)return null;
        return{descriptor:clone(record.freshEvidence.prepared),external:record.freshEvidence.external?clone(record.freshEvidence.external):null};
    }catch{return null;}
}
/** For the original pre-display reviewer; the same complete source reaches final review. */
export function preparedRequestReviewContext(ticket){
    const data=readPreparedRequest(ticket);if(!data)throw Error('Unknown prepared request');
    return{question:data.question,context:canonicalJSON({preparedRequest:data.logical,preparedSystemContext:data.systemContext})};
}
