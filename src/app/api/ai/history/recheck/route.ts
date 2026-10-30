import { historyHandlers } from "@/lib/ai/history/runtime.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const POST = (request: Request) => historyHandlers.recheck(request);
