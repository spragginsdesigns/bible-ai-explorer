import type { HistoryService, HistorySurface } from './contracts';
import type { HistoryReadSnapshot } from './read-snapshot.mjs';
import type { verifyScriptureDraft } from '../scripture-verification';
import type { getChapter } from '../../bible/translations';
type CanonicalDependencies = {verifyCanonical:typeof verifyScriptureDraft;loadCanonicalChapter:typeof getChapter};
export declare function createCanonicalReadCapture(dependencies:CanonicalDependencies,limits?:{maxEntries?:number;maxCharacters?:number}):{live:CanonicalDependencies;isOpen():boolean;freeze():CanonicalDependencies;counts():{checkedTexts:number;chapters:number;admitted:number;lateResults:number}};
export declare function readHistoryBatch(options:{ownerId:string;surface:HistorySurface;parentId:string;loadSnapshot():Promise<HistoryReadSnapshot|null>;createService(snapshot:HistoryReadSnapshot,canonical?:CanonicalDependencies):Pick<HistoryService,'get'>;verifyCanonical:CanonicalDependencies['verifyCanonical'];loadCanonicalChapter:CanonicalDependencies['loadCanonicalChapter'];captureMs?:number;requestMs?:number;freshReserveMs?:number}):Promise<{parent:HistoryReadSnapshot['parent'];rows:HistoryReadSnapshot['rows'];service:Pick<HistoryService,'get'>;externalCapture:ReturnType<ReturnType<typeof createCanonicalReadCapture>['counts']>&{timedOut:boolean}|null}|null>;
