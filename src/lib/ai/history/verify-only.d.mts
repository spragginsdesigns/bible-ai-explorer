import type {LanguageModel} from "ai";
import type {ModelDefinition} from "@/lib/ai/models";
import type {VerifyAnswerOptions} from "@/lib/ai/verified-generation";
import type {HistoryVerificationInput,HistoryVerificationResult} from "./contracts";
import type {GatedAnswer,AnswerBlock} from "@/lib/ai/answer-gate";
import type {TranslationId} from "@/lib/bible/translations";
export declare function createVerifyOnlyAdapter(deps:{houseChatModel(owner:string):Promise<{definition:ModelDefinition}>;resolveVerificationModel(owner:string,definition:ModelDefinition):Promise<LanguageModel>;providerOptionsForReview(definition:ModelDefinition):VerifyAnswerOptions["providerOptions"];verifyScriptureDraft(text:string,options:{translation:TranslationId}):Promise<{ok:boolean;text:string;references:readonly {canonicalText:string;verses:readonly unknown[]}[]}>;verifyGeneratedAnswer(blocks:AnswerBlock[],options:VerifyAnswerOptions):Promise<GatedAnswer>;isQuotaError(error:unknown):boolean}):(input:HistoryVerificationInput)=>Promise<HistoryVerificationResult>;
