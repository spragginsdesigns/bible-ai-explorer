import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";

// Refuse every host except this explicitly created disposable branch.
const branchHost = "ep-withered-dew-ak4ludji.c-3.us-west-2.aws.neon.tech";
const vars = parseEnv(fs.readFileSync(".env.local", "utf8"));
const url = new URL(vars.DATABASE_URL_UNPOOLED || vars.DATABASE_URL);
assert.notEqual(
  url.hostname,
  branchHost,
  "Expected the local config to remain on its existing database.",
);
url.hostname = branchHost;
assert.equal(url.pathname, "/neondb");
const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
const ids = [];
const pending = [];
const require = createRequire(import.meta.url);
const cache = new Map();
function load(relative, mocks = {}) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id === "server-only") return {};
      if (id === "@/lib/prisma") return { prisma };
      if (id === "@vercel/functions")
        return { waitUntil: (task) => pending.push(task) };
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`, mocks);
      if (id.startsWith("."))
        return load(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
      return require(id);
    },
    module,
    module.exports,
  );
  cache.set(filename, module.exports);
  return module.exports;
}
const baseUsage = {
  inputTokens: { total: 100, noCache: 50, cacheRead: 40, cacheWrite: 10 },
  outputTokens: { total: 20, text: 10, reasoning: 10 },
};
const fakeModel = {
  specificationVersion: "v4",
  provider: "openai.test",
  modelId: "gpt-5.6-luna",
  supportedUrls: {},
  async doGenerate() {
    return {
      content: [{ type: "text", text: "A completed study answer." }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: baseUsage,
      warnings: [],
    };
  },
  async doStream() {
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "text" });
          controller.enqueue({
            type: "text-delta",
            id: "text",
            delta: "A completed study answer.",
          });
          controller.enqueue({ type: "text-end", id: "text" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: baseUsage,
          });
          controller.close();
        },
      }),
      warnings: [],
    };
  },
};
const flush = async () => {
  while (pending.length) await Promise.allSettled(pending.splice(0));
};
async function user(plan = "free") {
  const id = `sureword-tier-test-${randomUUID()}`;
  ids.push(id);
  await prisma.user.create({ data: { id, plan } });
  return id;
}
let checks = 0;
try {
  const identity =
    await prisma.$queryRaw`SELECT current_database() AS database`;
  assert.equal(identity[0].database, "neondb");
  console.log(
    JSON.stringify({
      branchHost,
      database: identity[0].database,
      production: false,
    }),
  );
  const migrationOutput = execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: {
        ...process.env,
        DATABASE_URL: url.href,
        DATABASE_URL_UNPOOLED: url.href,
      },
      encoding: "utf8",
    },
  );
  console.log(
    migrationOutput.replace(
      /postgres(?:ql)?:\/\/[^\s"']+/g,
      "[connection redacted]",
    ),
  );
  process.env.SUREWORD_USAGE_ENABLED = "true";
  process.env.SERVER_CREDENTIAL_USER_IDS = "";
  process.env.PRO_USER_IDS = "";
  const {
    withIncludedAiRequest,
    meterIncludedModel,
    usageSnapshot,
    resolveRequestAccess,
    reserveIncludedRequest,
  } = load("src/lib/billing/usage.ts");
  function handler(userId, options = {}) {
    return withIncludedAiRequest(async () => {
      const model = meterIncludedModel(
        userId,
        options.fail
          ? {
              ...fakeModel,
              doGenerate: async () => {
                throw new Error("Synthetic provider outage");
              },
            }
          : fakeModel,
      );
      if (options.stream) {
        const { stream } = await model.doStream({ prompt: [] });
        return new Response(
          stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(chunk)),
                );
              },
            }),
          ),
        );
      }
      await model.doGenerate({ prompt: [] });
      return Response.json({ answered: true });
    }, "database-test");
  }
  const freeId = await user();
  const free = handler(freeId);
  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      free(new Request("http://localhost/test")),
    ),
  );
  await Promise.all(responses.map((response) => response.text()));
  await flush();
  assert.equal(responses.filter((r) => r.status === 200).length, 10);
  assert.equal(responses.filter((r) => r.status === 429).length, 2);
  assert.equal((await usageSnapshot(freeId)).dailyRemaining, 0);
  checks++;
  let openedStream = false;
  const preflight = withIncludedAiRequest(async () => {
    await reserveIncludedRequest(freeId);
    openedStream = true;
    return new Response("stream opened");
  }, "preflight-test");
  const exhausted = await preflight(new Request("http://localhost/test"));
  assert.equal(exhausted.status, 429);
  assert.equal(openedStream, false);
  assert.equal((await exhausted.json()).code, "rate_limited");
  checks++;
  const ledger = await prisma.aiUsageRequest.findMany({
    where: { userId: freeId },
  });
  assert.equal(ledger.length, 10);
  assert.ok(
    ledger.every((row) => row.costMicros === 38 && row.status === "completed"),
  );
  checks++;
  const retryId = await user();
  const key = randomUUID();
  const retry = handler(retryId);
  const request = () =>
    new Request("http://localhost/test", {
      headers: { "Idempotency-Key": key },
    });
  const duplicates = await Promise.all([retry(request()), retry(request())]);
  await Promise.all(duplicates.map((r) => r.text()));
  await flush();
  assert.deepEqual(duplicates.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    await prisma.aiUsageRequest.count({ where: { userId: retryId } }),
    1,
  );
  checks++;
  const failureId = await user();
  await assert.rejects(
    handler(failureId, { fail: true })(new Request("http://localhost/test")),
    /Synthetic provider outage/,
  );
  await flush();
  assert.equal((await usageSnapshot(failureId)).dailyRemaining, 10);
  checks++;
  const streamId = await user();
  const response = await handler(streamId, { stream: true })(
    new Request("http://localhost/test"),
  );
  await response.body.cancel();
  await flush();
  assert.equal((await usageSnapshot(streamId)).dailyRemaining, 9);
  checks++;
  const proId = await user("pro");
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  await prisma.aiUsageRequest.createMany({
    data: Array.from({ length: 600 }, (_, index) => ({
      id: randomUUID(),
      userId: proId,
      idempotencyKey: `seed-${index}`,
      surface: "test",
      status: "completed",
      createdAt: yesterday,
    })),
  });
  const proResponse = await handler(proId)(
    new Request("http://localhost/test"),
  );
  await proResponse.text();
  await flush();
  assert.equal(proResponse.status, 429);
  checks++;
  const otherId = await user();
  assert.equal((await usageSnapshot(otherId)).dailyRemaining, 10);
  checks++;
  let payerReads = 0;
  const stablePayer = withIncludedAiRequest(async () => {
    const first = await resolveRequestAccess(otherId, async () => {
      payerReads++;
      return "house";
    });
    const afterSettingsChange = await resolveRequestAccess(
      otherId,
      async () => {
        payerReads++;
        return "keys";
      },
    );
    assert.equal(first, "house");
    assert.equal(afterSettingsChange, "house");
    return Response.json({ ok: true });
  }, "payer-test");
  await (await stablePayer(new Request("http://localhost/test"))).text();
  await flush();
  assert.equal(payerReads, 1);
  checks++;
  const backgroundUser = await user();
  let automaticCalls = 0;
  const automaticModel = {
    ...fakeModel,
    doGenerate: async () => {
      automaticCalls++;
      return fakeModel.doGenerate();
    },
  };
  for (let index = 0; index < 3; index++)
    await meterIncludedModel(backgroundUser, automaticModel, true).doGenerate({
      prompt: [],
    });
  assert.equal((await usageSnapshot(backgroundUser)).dailyRemaining, 10);
  await prisma.aiUsageRequest.createMany({
    data: Array.from({ length: 17 }, () => ({
      id: randomUUID(),
      userId: backgroundUser,
      idempotencyKey: randomUUID(),
      surface: "background-utility",
      status: "completed",
    })),
  });
  await assert.rejects(
    meterIncludedModel(backgroundUser, automaticModel, true).doGenerate({
      prompt: [],
    }),
    /Automatic study tools/,
  );
  assert.equal(automaticCalls, 3);
  assert.equal((await usageSnapshot(backgroundUser)).dailyRemaining, 10);
  checks++;
  console.log(
    JSON.stringify({
      passed: checks,
      cases: [
        "12 concurrent Free requests admit exactly 10",
        "exhausted allowance rejects before the stream opens",
        "token/cache cost settlement",
        "concurrent idempotency",
        "failed answer releases allowance",
        "client disconnect still counts completed answer",
        "Pro monthly cap",
        "account isolation",
        "payer remains stable during an answer",
        "automatic utility budget does not consume chat messages",
      ],
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      failed: true,
      name: error.name,
      code: error.code,
      message: String(error.message)
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[connection redacted]")
        .slice(0, 1200),
    }),
  );
  process.exitCode = 1;
} finally {
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
