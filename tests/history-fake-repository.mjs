/** Test double only. It does not prove actual PostgreSQL/Prisma constraint or isolation behavior. */
import { HistoryError } from '../src/lib/ai/history/service.mjs';
import { recoveredFreshActions } from '../src/lib/ai/history/fresh-proof.mjs';
import {historyAISourceRow} from '../src/lib/ai/history/projection.mjs';
import {digest} from '../src/lib/ai/history/projection.mjs';
import {preparedReviewRecord} from '../src/lib/ai/history/prepared-request.mjs';
const copy = value => structuredClone(value), refs = record => record.mainMessageId ?? record.noteAiMessageId;
const same = (record, binding) => Object.keys(binding).every(key => record[key] === binding[key]);
export class FakeRepository {
    users = new Map();
    parents = new Map();
    messages = new Map();
    reviews = new Map();
    proofs = new Map();
    attachments = new Map();
    locks = new Map();
    depth = new Map();
    creates = 0;
    finishes = 0;
    addUser(id, consent = true) { this.users.set(id, { consent }); }
    addParent(surface, id, ownerId) { this.parents.set(surface + ':' + id, { ownerId }); }
    put(surface, parentId, row) { this.messages.set(row.id, { surface, parentId, row: copy(row) }); }
    deleteMessage(id) { this.messages.delete(id); for (const [key, value] of this.reviews)
        if (refs(value) === id)
            this.reviews.delete(key); }
    deleteParent(surface, id) { for (const [key, value] of this.messages)
        if (value.surface === surface && value.parentId === id)
            this.deleteMessage(key); this.parents.delete(surface + ':' + id); }
    deleteUser(id) { for (const [key, value] of this.parents)
        if (value.ownerId === id) {
            const [surface, ...parent] = key.split(':');
            this.deleteParent(surface, parent.join(':'));
        } this.users.delete(id); for (const [key, value] of this.reviews)
        if (value.ownerId === id)
            this.reviews.delete(key); }
    async withOwnerLock(ownerId, callback) {
        const previous = this.locks.get(ownerId) ?? Promise.resolve();
        let release;
        const current = new Promise(resolve => release = resolve);
        this.locks.set(ownerId, current);
        await previous;
        if (!this.users.has(ownerId)) {
            release();
            throw new HistoryError('not_found', 404);
        }
        this.depth.set(ownerId, (this.depth.get(ownerId) ?? 0) + 1);
        const owned = locator => { const value = this.messages.get(locator.messageId), parent = this.parents.get(locator.surface + ':' + locator.parentId); return value && parent?.ownerId === ownerId && value.surface === locator.surface && value.parentId === locator.parentId ? value : null; };
        const tx = {
            currentTime: async () => this.clock ? this.clock() : new Date(),
            readPolicySnapshot: async () => ({user:{id:ownerId,plan:this.users.get(ownerId)?.plan??"free",aiConsentVersion:1,aiConsentAt:new Date()},subscription:this.users.get(ownerId)?.subscription??null}),
            hasConsent: async () => this.users.get(ownerId)?.consent === true,
            loadOwnedTarget: async (locator) => owned(locator) ? copy(owned(locator).row) : null,
            loadPreparedDependencies:async(locator,ids,attachmentIds)=>({rows:ids.flatMap(id=>{const value=this.messages.get(id);return value&&value.surface===locator.surface&&value.parentId===locator.parentId&&this.parents.get(locator.surface+':'+locator.parentId)?.ownerId===ownerId?[copy(value.row)]:[];}),attachments:attachmentIds.flatMap(id=>{const row=this.attachments.get(id);return row&&row.userId===ownerId&&ids.includes(row.messageId)?[copy(row)]:[];})}),
            loadPreparedReview:async locator=>{const target=owned(locator)?.row;if(!target)return null;const source={surface:locator.surface,parentId:locator.parentId,ownerId,row:historyAISourceRow(target)};const records=[...this.reviews.values()].filter(record=>record.ownerId===ownerId&&record.sourceDigest===digest(source)&&record.state==='verified').sort((a,b)=>new Date(b.checkedAt)-new Date(a.checkedAt)||new Date(b.createdAt)-new Date(a.createdAt)||b.id.localeCompare(a.id));return records.length?preparedReviewRecord(records[0],source):null;},
            loadOwnedBundle: async (locator, max) => { const target = owned(locator); if (!target)
                return null; const prefix = [...this.messages.values()].filter(v => v.surface === locator.surface && v.parentId === locator.parentId && v.row.createdAt <= target.row.createdAt).map(v => copy(v.row)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); return { target: copy(target.row), prefix: prefix.slice(0, max + 1), complete: prefix.length <= max, attachmentsPresent: prefix.some(v => v.hasAttachments) }; },
            loadFreshBundle: async (locator,draft,max) => {
                if(this.parents.get(locator.surface+':'+locator.parentId)?.ownerId!==ownerId)return null;
                const existing=this.messages.get(locator.messageId);
                if(existing&&(!owned(locator)||existing.row.role!=='assistant'))throw new HistoryError('not_found',404);
                const target=existing?{...copy(existing.row),content:draft.content,metadata:copy(draft.metadata)}:{id:locator.messageId,role:'assistant',content:draft.content,metadata:copy(draft.metadata),createdAt:draft.createdAt??(await tx.currentTime()).toISOString(),...(locator.surface==='chat'?{conversationId:locator.parentId,feedback:null,feedbackReason:null,feedbackTags:[],feedbackAt:null,feedbackReviewedAt:null}:{noteId:locator.parentId})};
                const prefix=[...this.messages.values()].filter(v=>v.surface===locator.surface&&v.parentId===locator.parentId&&v.row.id!==target.id&&(draft.sourceWindow?draft.sourceWindow.includes(v.row.id):v.row.createdAt<=target.createdAt)).map(v=>copy(v.row));
                return{target,previous:existing?copy(existing.row):null,prefix:[...prefix,target].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),complete:draft.sourceWindow?prefix.length===draft.sourceWindow.length:prefix.length<max,attachmentsPresent:prefix.some(v=>v.hasAttachments)};
            },
            saveFreshTarget:async(locator,target)=>{this.put(locator.surface,locator.parentId,target);return copy(target);},
            loadDurableActionProof: async (locator, actions) => { const p = this.proofs.get(locator.messageId); if(p)return copy(p); const target=owned(locator)?.row;if(target){const source={surface:locator.surface,parentId:locator.parentId,ownerId,row:historyAISourceRow(target)};for(const record of this.reviews.values()){const manifest=recoveredFreshActions(record,source,actions);if(manifest)return{complete:true,manifest};}}return { complete: false, manifest: [] }; },
            findBinding: async (binding) => copy([...this.reviews.values()].find(r => r.ownerId === ownerId && same(r, binding)) ?? null),
            activeLease: async (now) => copy([...this.reviews.values()].find(r => r.ownerId === ownerId && r.state === 'pending' && r.expiresAt > now) ?? null),
            expireLeases: async (now) => { for (const r of this.reviews.values())
                if (r.ownerId === ownerId && r.state === 'pending' && r.expiresAt <= now)
                    Object.assign(r, { state: 'withheld', leaseToken: null, expiresAt: null, retryAfter: now, issueCodes: ['lease_expired'], checkedAt: now, updatedAt: now }); },
            createReview: async (data) => { if (data.state === 'pending' && [...this.reviews.values()].some(r => r.ownerId === ownerId && r.state === 'pending'))
                throw Error('one pending owner'); if ([...this.reviews.values()].some(r => r.ownerId === ownerId && r.envelopeDigest === data.envelopeDigest))
                throw Error('unique binding'); const record = { ...copy(data), id: 'review-' + (++this.creates) }; this.reviews.set(record.id, record); return copy(record); },
            certifyFreshReview:async(id,data)=>{const record=this.reviews.get(id);if(!record||record.ownerId!==ownerId||!['pending','withheld'].includes(record.state))return false;Object.assign(record,copy(data),{leaseToken:null,expiresAt:null});return true;},
            retryLease: async (id, { leaseToken, expiresAt, now }) => { const r = this.reviews.get(id); if (!r || r.ownerId !== ownerId || r.state !== 'withheld' || !r.retryAfter || r.retryAfter > now)
                return null; Object.assign(r, { state: 'pending', leaseToken, expiresAt, retryAfter: null, issueCodes: [], canonicalPassed: false, semanticPassed: false, actionProofPassed: false, reviewerModelId: null, attemptCount: r.attemptCount + 1, updatedAt: now, checkedAt: null }); return copy(r); },
            findLease: async (id, token, now) => { const r = this.reviews.get(id); return r && r.ownerId === ownerId && r.state === 'pending' && r.leaseToken === token && r.expiresAt > now ? copy(r) : null; },
            finishLease: async (id, token, now, data) => { const r = this.reviews.get(id); if (!r || r.ownerId !== ownerId || r.state !== 'pending' || r.leaseToken !== token || r.expiresAt <= now)
                return false; Object.assign(r, copy(data), { leaseToken: null, expiresAt: null, checkedAt: now, updatedAt: now }); this.finishes++; return true; },
            targetVersions: async (locator, reviewId, take, after = null) => { const values = [...this.reviews.values()].filter(r => r.ownerId === ownerId && refs(r) === locator.messageId && (!reviewId || r.id === reviewId)).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)); const index = after ? values.findIndex(r => r.id === after) : -1; if (after && index < 0)
                throw new HistoryError('not_found', 404); return values.slice(index + 1, index + 1 + take).map(copy); },
        };
        try {
            return await callback(tx);
        }
        finally {
            this.depth.set(ownerId, this.depth.get(ownerId) - 1);
            release();
            if (this.locks.get(ownerId) === current)
                this.locks.delete(ownerId);
        }
    }
}
