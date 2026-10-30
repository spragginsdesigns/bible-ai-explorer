import { historyHandlers } from "@/lib/ai/history/runtime.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => historyHandlers.original(request);
