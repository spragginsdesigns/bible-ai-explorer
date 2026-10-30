import type {StoredAssistantTurn} from "@/lib/chat/trusted-history";
import type {HistoryService,HistorySurface} from "./contracts";

const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Raw saved/client assistant content never becomes future model context. */
export async function reviewedAssistantTurns(service:Pick<HistoryService,"get">,ownerId:string,surface:HistorySurface,parentId:string,ownedRows:readonly StoredAssistantTurn[]):Promise<StoredAssistantTurn[]>{
	const rows=await Promise.all(ownedRows.map(async(source):Promise<StoredAssistantTurn|null>=>{
		try{
			const result=await service.get(ownerId,{surface,parentId,messageId:source.id});
			const body=record(result.body),row=record(body?.row),metadata=record(row?.metadata);
			if(result.status!==200||!body||(body.state!=="verified"&&body.state!=="notice")||typeof body.sourceDigest!=="string"||!/^[a-f0-9]{64}$/.test(body.sourceDigest)||!row||row.id!==source.id||row.role!=="assistant"||typeof row.content!=="string"||!metadata||!Array.isArray(metadata.parts)||Object.hasOwn(metadata,"historyVerification"))return null;
			return{id:source.id,content:row.content,metadata};
		}catch{return null;}
	}));
	return rows.filter((row):row is StoredAssistantTurn=>row!==null);
}
