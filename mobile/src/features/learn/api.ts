import { apiJson, type GetToken } from "@/lib/api";
import type { LearnCard, LearnToday } from "./learn";
import { parseCard } from "./learn";
export async function addLearnVerse(getToken: GetToken, input: {
 book: number; chapter: number; verse: number;
 translation: "KJV" | "NKJV"; source: "sheet" | "highlight" | "chat";
}) {
 return parseCard(await apiJson<LearnCard>(getToken, "/api/learn", { method: "POST", body: input }));
}
export function fetchLearnToday(getToken: GetToken) { return apiJson<LearnToday>(getToken, "/api/learn/today"); }
export function reviewLearnCard(getToken: GetToken, id: string, result: "again" | "good") { return apiJson<LearnCard>(getToken, `/api/learn/${id}/review`, { method: "POST", body: { result } }); }
