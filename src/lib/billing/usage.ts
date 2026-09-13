import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { prisma } from "@/lib/prisma";
import { getUserPlan } from "@/lib/entitlements";
import { calendarMonthWindow, quotaDecision, utcDayWindow } from "./plans";
import { IncludedAiLimitError } from "./usage-errors";
import type { AiAccess } from "@/lib/ai/access";

type Scope = {
  id: string;
  surface: string;
  idempotencyKey: string;
  userId?: string;
  reservation?: Promise<void>;
  visible: boolean;
  calls: number;
  ended: boolean;
  denied?: IncludedAiLimitError;
  accessResolution?: Promise<AiAccess>;
  background?: boolean;
};
const scopes = new AsyncLocalStorage<Scope>();
export const usageEnabled = () => process.env.SUREWORD_USAGE_ENABLED === "true";

/** Keep the payer stable across tools and background work even if Settings changes mid-answer. */
export function resolveRequestAccess(
  userId: string,
  resolve: () => Promise<AiAccess>,
): Promise<AiAccess> {
  const scope = scopes.getStore();
  if (!scope) return resolve();
  if (scope.userId && scope.userId !== userId)
    throw new Error("AI request account changed.");
  scope.userId = userId;
  return (scope.accessResolution ??= resolve());
}

export async function usageSnapshot(userId: string, now = new Date()) {
  const pro = (await getUserPlan(userId)) === "pro";
  const subscription = pro
    ? await prisma.billingSubscription.findUnique({ where: { userId } })
    : null;
  const month =
    subscription &&
    subscription.periodStart <= now &&
    subscription.periodEnd > now
      ? { start: subscription.periodStart, end: subscription.periodEnd }
      : calendarMonthWindow(now);
  const day = utcDayWindow(now);
  const [daily, monthly] = await Promise.all([
    prisma.aiUsageRequest.count({
      where: {
        userId,
        surface: { not: "background-utility" },
        status: { not: "failed" },
        createdAt: { gte: day.start, lt: day.end },
      },
    }),
    pro
      ? prisma.aiUsageRequest.count({
          where: {
            userId,
            surface: { not: "background-utility" },
            status: { not: "failed" },
            createdAt: { gte: month.start, lt: month.end },
          },
        })
      : 0,
  ]);
  return {
    ...quotaDecision({ pro, daily, monthly }),
    pro,
    daily,
    monthly,
    day,
    month,
  };
}

async function reserve(scope: Scope, userId: string) {
  if (scope.userId && scope.userId !== userId)
    throw new Error("AI request account changed.");
  if (scope.reservation) return scope.reservation;
  scope.userId = userId;
  scope.reservation = (async () => {
    const pro = (await getUserPlan(userId)) === "pro";
    await prisma.$transaction(
      async (tx) => {
        // Lock the account before counting; all concurrent writers use this same lock.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        if (
          await tx.aiUsageRequest.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey: scope.idempotencyKey,
              },
            },
          })
        ) {
          throw new IncludedAiLimitError(
            "This request was already received. Reopen the saved conversation before sending again.",
            409,
          );
        }
        const now = new Date();
        const day = utcDayWindow(now);
        if (scope.background) {
          const attempts = await tx.aiUsageRequest.count({
            where: {
              userId,
              surface: "background-utility",
              createdAt: { gte: day.start, lt: day.end },
            },
          });
          if (attempts >= (pro ? 100 : 20))
            throw new IncludedAiLimitError(
              "Automatic study tools have reached today's service limit. Your chat allowance is unchanged.",
              429,
              day.end,
            );
          await tx.aiUsageRequest.create({
            data: {
              id: scope.id,
              userId,
              idempotencyKey: scope.idempotencyKey,
              surface: "background-utility",
            },
          });
          return;
        }
        const sub = pro
          ? await tx.billingSubscription.findUnique({ where: { userId } })
          : null;
        const month =
          sub && sub.periodStart <= now && sub.periodEnd > now
            ? { start: sub.periodStart, end: sub.periodEnd }
            : calendarMonthWindow(now);
        const daily = await tx.aiUsageRequest.count({
          where: {
            userId,
            surface: { not: "background-utility" },
            status: { not: "failed" },
            createdAt: { gte: day.start, lt: day.end },
          },
        });
        const attempts = await tx.aiUsageRequest.count({
          where: {
            userId,
            surface: { not: "background-utility" },
            createdAt: { gte: day.start, lt: day.end },
          },
        });
        if (attempts >= (pro ? 150 : 30))
          throw new IncludedAiLimitError(
            "Too many AI attempts today. Please return after the daily reset or use a personal API key.",
            429,
            day.end,
          );
        const monthly = pro
          ? await tx.aiUsageRequest.count({
              where: {
                userId,
                surface: { not: "background-utility" },
                status: { not: "failed" },
                createdAt: { gte: month.start, lt: month.end },
              },
            })
          : 0;
        const quota = quotaDecision({ pro, daily, monthly });
        if (!quota.allowed) {
          const reset = quota.monthlyRemaining === 0 ? month.end : day.end;
          throw new IncludedAiLimitError(
            `You've used your included AI allowance. More messages are available at ${reset.toISOString()}. You can keep reading, revisit saved study, or use your own API key.`,
            429,
            reset,
          );
        }
        await tx.aiUsageRequest.create({
          data: {
            id: scope.id,
            userId,
            idempotencyKey: scope.idempotencyKey,
            surface: scope.surface,
          },
        });
      },
      { timeout: 15000 },
    );
  })().catch((error) => {
    if (error instanceof IncludedAiLimitError) scope.denied = error;
    throw error;
  });
  return scope.reservation;
}

async function finish(scope: Scope) {
  if (!scope.reservation || scope.ended) return;
  scope.ended = true;
  try {
    await scope.reservation;
    await prisma.aiUsageRequest.update({
      where: { id: scope.id },
      data: { status: scope.visible ? "completed" : "failed" },
    });
  } catch {
    /* Failed reservations never created a row. Leave uncertain persisted rows reserved. */
  }
}

/** The response branch is drained independently so closing the app cannot refund an answer. */
export function withIncludedAiRequest<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
  surface: string,
) {
  return async (...args: T): Promise<Response> => {
    if (!usageEnabled()) return handler(...args);
    const req = args[0] instanceof Request ? args[0] : null;
    const supplied = req?.headers.get("Idempotency-Key");
    if (supplied && !/^[a-zA-Z0-9_-]{16,100}$/.test(supplied))
      return Response.json(
        { error: "Invalid request identifier." },
        { status: 400 },
      );
    const scope: Scope = {
      id: randomUUID(),
      idempotencyKey: `${surface}:${supplied ?? randomUUID()}`,
      surface,
      visible: false,
      calls: 0,
      ended: false,
    };
    return scopes.run(scope, async () => {
      try {
        const response = await handler(...args);
        if (scope.denied && response.status >= 400) {
          return Response.json(
            {
              error: scope.denied.message,
              code: "rate_limited",
              resetAt: scope.denied.resetAt?.toISOString(),
            },
            { status: scope.denied.status },
          );
        }
        if (
          response.ok &&
          response.headers.get("content-type")?.includes("application/json") &&
          scope.calls > 0
        )
          scope.visible = true;
        if (!response.body) {
          await finish(scope);
          return response;
        }
        const [client, monitor] = response.body.tee();
        waitUntil(
          (async () => {
            try {
              const reader = monitor.getReader();
              while (!(await reader.read()).done) {
                /* Drain only, never log content. */
              }
            } finally {
              await finish(scope);
            }
          })(),
        );
        return new Response(client, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (error) {
        await finish(scope);
        if (error instanceof IncludedAiLimitError)
          return Response.json(
            {
              error: error.message,
              code: "rate_limited",
              resetAt: error.resetAt?.toISOString(),
            },
            { status: error.status },
          );
        throw error;
      }
    });
  };
}

/** Meter only included inference. Personal keys and owner credentials never enter this wrapper. */
export function meterIncludedModel(
  userId: string,
  model: Exclude<LanguageModel, string>,
  utility = false,
): Exclude<LanguageModel, string> {
  if (!usageEnabled()) return model;
  const currentScope = scopes.getStore();
  if (!currentScope && !utility)
    throw new Error("Included chat requires a metered request scope.");
  // Automatic work gets a separate daily budget and ledger, never a hidden chat-message deduction.
  const scope: Scope = currentScope ?? {
    id: randomUUID(),
    idempotencyKey: randomUUID(),
    surface: "background-utility",
    visible: false,
    calls: 0,
    ended: false,
    background: true,
  };
  const record = async (usage: {
    inputTokens: { total?: number; cacheRead?: number; cacheWrite?: number };
    outputTokens: { total?: number };
  }) => {
    const input = usage.inputTokens.total ?? 0,
      output = usage.outputTokens.total ?? 0,
      cache = usage.inputTokens.cacheRead ?? 0;
    const cacheWrite = usage.inputTokens.cacheWrite ?? 0;
    await prisma.aiUsageRequest.update({
      where: { id: scope.id },
      data: {
        inputTokens: { increment: input },
        outputTokens: { increment: output },
        cacheTokens: { increment: cache },
        costMicros: {
          increment: Math.ceil(
            (input - cache - cacheWrite) * 0.2 +
              cache * 0.02 +
              cacheWrite * 0.25 +
              output * 1.2,
          ),
        },
      },
    });
  };
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => {
        await reserve(scope, userId);
        if (Buffer.byteLength(JSON.stringify(params.prompt), "utf8") > 300000)
          throw new IncludedAiLimitError(
            "This study is too large for one included request. Use a shorter conversation or smaller attachment.",
            413,
          );
        if (++scope.calls > 12)
          throw new IncludedAiLimitError(
            "This study needs more AI steps than one included message allows. Try a more focused question.",
          );
        await prisma.aiUsageRequest.update({
          where: { id: scope.id },
          data: { calls: { increment: 1 } },
        });
        return {
          ...params,
          maxOutputTokens: Math.min(params.maxOutputTokens ?? 8192, 8192),
        };
      },
      wrapGenerate: async ({ doGenerate }) => {
        try {
          const result = await doGenerate();
          if (
            (!utility || scope.background) &&
            result.finishReason.unified === "stop" &&
            result.content.some(
              (part) => part.type === "text" && part.text.trim(),
            )
          )
            scope.visible = true;
          await record(result.usage);
          return result;
        } finally {
          if (scope.background) await finish(scope);
        }
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        let hasText = false;
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                if (chunk.type === "text-delta" && chunk.delta.trim())
                  hasText = true;
                if (chunk.type === "finish") {
                  if (
                    (!utility || scope.background) &&
                    hasText &&
                    chunk.finishReason.unified === "stop"
                  )
                    scope.visible = true;
                  await record(chunk.usage);
                }
                controller.enqueue(chunk);
              },
              async flush() {
                if (scope.background) await finish(scope);
              },
            }),
          ),
        };
      },
    },
  });
}
