import { apiJson, type GetToken } from "@/lib/api";
import type { LearnCard, LearnToday } from "./learn";
export function fetchLearnToday(getToken: GetToken) { return apiJson<LearnToday>(getToken, "/api/learn/today"); }
export function reviewLearnCard(getToken: GetToken, id: string, result: "again" | "good") { return apiJson<LearnCard>(getToken, `/api/learn/${id}/review`, { method: "POST", body: { result } }); }
