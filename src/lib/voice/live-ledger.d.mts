export interface LiveTranscriptIdentity { id:string;userId:string;clerkSessionId:string;conversationId:string }
export interface LiveTranscript { id:string;segmentId:string;role:"user"|"assistant";canonicalMessageId:string|null;text:string;complete:boolean;startMs:number;endMs:number }
export interface LiveGrant { id: string; userId: string; clerkSessionId: string; conversationId: string; seconds: number; chargedSeconds: number; createdAt: number; expiresAt: number; state: "reserved" | "active" | "closing" | "settled"; confirmed: boolean | null; settledAt: number | null }
export interface LiveTurn { id: string; turnId: string; userMessageId: string; text: string; state: "pending" | "done"; result?: { assistantMessageId: string; text: string; toolParts: unknown; streamError: boolean } }
export interface LiveLedger {
 reserve(input: { userId: string; clerkSessionId: string; conversationId: string; limits: { sessionSeconds: number; dailySeconds: number; monthlySeconds: number }; now?: number }): LiveGrant;
 get(id: string): LiveGrant | null;
 setConversation(id: string, conversationId: string): LiveGrant;
 claim(id: string, now?: number): LiveGrant;
 stop(id: string): LiveGrant;
 remaining(userId: string, limits: { sessionSeconds: number; dailySeconds: number; monthlySeconds: number }, now?: number): number;
 settle(id: string, seconds: number, confirmed: boolean, now?: number): LiveGrant;
 claimTurn(id: string, turnId: string, userMessageId: string, text: string, options?:{deadline:number}): { claimed: boolean; turn: LiveTurn };
 getTurn(id: string, turnId: string): LiveTurn | null;
 finishTurn(id: string, turnId: string, result: LiveTurn["result"], options?:{deadline:number}): LiveTurn;
 saveTranscript(identity:LiveTranscriptIdentity,input:Omit<LiveTranscript,"id"|"canonicalMessageId"|"startMs"|"endMs">&{canonicalMessageId?:string|null;startMs?:number;endMs?:number},now?:number):LiveTranscript;
 getTranscript(identity:LiveTranscriptIdentity,segmentId:string,now?:number):LiveTranscript|null;
 bindTranscript(identity:LiveTranscriptIdentity,segmentId:string,canonicalMessageId:string,role:LiveTranscript["role"],now?:number,options?:{deadline:number}):LiveTranscript;
 close(): void;
}
export function openLiveLedger(path: string): LiveLedger;
