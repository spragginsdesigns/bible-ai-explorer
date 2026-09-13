// Read-only model comparison. No user data, app mutations, or provider keys in output.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import ts from "typescript";

const env = parseEnv(await readFile(".env.local", "utf8"));
const apiKey = env.OPENAI_FREE_TIER_API_KEY;
if (!apiKey) throw new Error("OPENAI_FREE_TIER_API_KEY is required.");
const source = await readFile("src/utils/systemPrompt.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const prompts = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const files = await readdir("src/data/kjv");
const books = new Map();
for (const file of files.filter((name) => /^\d+-.+\.json$/.test(name))) {
  books.set(
    file
      .replace(/^\d+-|\.json$/g, "")
      .replaceAll("-", " ")
      .toLowerCase(),
    JSON.parse(await readFile(`src/data/kjv/${file}`, "utf8")),
  );
}
const cases = [
  ["abide", "What does it mean to abide in Christ in John 15:1-7?", "John 15"],
  [
    "salvation",
    "Explain Ephesians 2:8-10 and how grace and good works fit together.",
    "Ephesians 2",
  ],
  [
    "anxiety",
    "I am anxious about tomorrow. Help me understand Matthew 6:25-34 gently.",
    "Matthew 6",
  ],
  [
    "context",
    "Does Philippians 4:13 promise I will succeed at anything I attempt?",
    "Philippians 4",
  ],
  [
    "forgiveness",
    "Explain forgiveness in Ephesians 4:31-32 with one practical step.",
    "Ephesians 4",
  ],
  [
    "grief",
    "My friend is grieving. What comfort does John 11:32-36 offer without pretending grief is easy?",
    "John 11",
  ],
  [
    "false_quote",
    'Is "God helps those who help themselves" a Bible verse? Be precise.',
    null,
  ],
  [
    "psalm",
    "Explain Psalm 23:4 without promising that believers will never face danger.",
    "Psalms 23",
  ],
  [
    "comparison",
    "Compare Romans 3:28 with James 2:14-26. Explain the context of faith and works.",
    "James 2",
  ],
  [
    "short",
    "In two sentences, explain what James 1:5 invites me to do.",
    "James 1",
  ],
  ["neighbor", "Who is my neighbor according to Luke 10:25-37?", "Luke 10"],
  [
    "quote",
    "Quote Romans 8:1 exactly from the KJV, then explain the verse in context.",
    "Romans 8",
  ],
  [
    "search_phrase",
    'Find the KJV verse containing "faithful are the wounds of a friend" and explain it in context.',
    "Proverbs 27",
  ],
  [
    "search_context",
    'Find the words "be still, and know that I am God" in the KJV. Read the surrounding verses and explain their context.',
    "Psalm 46",
  ],
];
function findVerses({ query, book, limit }) {
  const words = String(query)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const hits = [];
  for (const [name, chapters] of books) {
    if (book && name !== book.toLowerCase().replace(/^psalm$/, "psalms"))
      continue;
    for (let c = 0; c < chapters.length; c++)
      for (let v = 0; v < chapters[c].length; v++) {
        const text = chapters[c][v];
        if (
          words.length &&
          words.every((word) => text.toLowerCase().includes(word))
        )
          hits.push({
            reference: `${name} ${c + 1}:${v + 1}`,
            text,
            translation: "KJV",
          });
        if (hits.length >= Math.min(limit || 8, 20)) return { verses: hits };
      }
  }
  return { verses: hits };
}
function passage(reference) {
  const match = /^(.+?)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?$/.exec(
    reference.trim(),
  );
  if (!match)
    return { error: "Use Book chapter:verse or Book chapter:start-end." };
  let book = match[1].toLowerCase();
  if (book === "psalm") book = "psalms";
  const chapter = books.get(book)?.[Number(match[2]) - 1];
  if (!chapter) return { error: "Passage not found." };
  const start = Number(match[3] ?? 1),
    end = Math.min(
      Number(match[4] ?? match[3] ?? chapter.length),
      chapter.length,
      start + 39,
    );
  return {
    translation: "KJV",
    reference,
    verses: chapter
      .slice(start - 1, end)
      .map((text, index) => ({ verse: start + index, text })),
  };
}
const outputDir = resolve(
  process.env.TIER_EVAL_OUTPUT ?? "artifacts/tier-launch-20260913/model-eval",
);
await mkdir(outputDir, { recursive: true });
const results = [];
let totalCost = 0;
const repetitions = Number(process.env.TIER_EVAL_REPETITIONS ?? 2);
const efforts = (process.env.TIER_EVAL_EFFORTS ?? "low,medium,high").split(",");
const maxCost = 3;
for (let repeat = 0; repeat < repetitions; repeat++) {
  for (const [id, question, expected] of cases) {
    for (const effort of repeat % 2 ? [...efforts].reverse() : efforts) {
      const started = Date.now();
      const input = [{ role: "user", content: question }];
      let inputTokens = 0,
        outputTokens = 0,
        reasoningTokens = 0,
        cacheTokens = 0,
        cacheWriteTokens = 0,
        cost = 0,
        answer = "",
        calls = [],
        status = "step_limit";
      for (let step = 0; step < 5; step++) {
        if (totalCost + 0.08 > maxCost) {
          status = "budget_limit";
          break;
        }
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.6-luna",
            store: false,
            instructions: prompts.chatSystemPrompt("KJV"),
            input,
            reasoning: { effort },
            max_output_tokens: 8192,
            tools: [
              {
                type: "function",
                name: "getPassage",
                description:
                  "Fetch exact KJV Scripture by reference. Use this before quoting.",
                strict: true,
                parameters: {
                  type: "object",
                  properties: {
                    book: { type: "string" },
                    chapter: { type: "integer" },
                    verseStart: { type: "integer" },
                    verseEnd: { type: ["integer", "null"] },
                  },
                  required: ["book", "chapter", "verseStart", "verseEnd"],
                  additionalProperties: false,
                },
              },
              {
                type: "function",
                name: "findVerses",
                description:
                  "Find KJV verses containing exact words or phrases. Use when you know the words but not the reference.",
                strict: true,
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    book: { type: ["string", "null"] },
                    limit: { type: ["integer", "null"] },
                  },
                  required: ["query", "book", "limit"],
                  additionalProperties: false,
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(90000),
        }).catch((error) => ({
          ok: false,
          status: 0,
          json: async () => ({ error: { code: error.name } }),
        }));
        const data = await response.json();
        if (!response.ok) {
          status = `error:${response.status}:${data.error?.code ?? "unknown"}`;
          break;
        }
        const usage = data.usage;
        const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
        const written = usage?.input_tokens_details?.cache_write_tokens ?? 0;
        const stepCost =
          (((usage?.input_tokens ?? 0) - cached - written) * 0.2) / 1e6 +
          (cached * 0.02) / 1e6 +
          (written * 0.25) / 1e6 +
          ((usage?.output_tokens ?? 0) * 1.2) / 1e6;
        totalCost += stepCost;
        cost += stepCost;
        inputTokens += usage?.input_tokens ?? 0;
        outputTokens += usage?.output_tokens ?? 0;
        cacheTokens += cached;
        cacheWriteTokens += written;
        reasoningTokens += usage?.output_tokens_details?.reasoning_tokens ?? 0;
        input.push(...(data.output ?? []));
        const toolCalls = (data.output ?? []).filter(
          (item) => item.type === "function_call",
        );
        answer += (data.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text)
          .join("\n");
        if (!toolCalls.length) {
          status = data.status;
          break;
        }
        for (const call of toolCalls) {
          let result;
          try {
            const args = JSON.parse(call.arguments);
            if (call.name === "findVerses") {
              calls.push(`findVerses:${args.query}`);
              result = findVerses(args);
            } else {
              const reference = `${args.book} ${args.chapter}:${args.verseStart}${args.verseEnd ? `-${args.verseEnd}` : ""}`;
              calls.push(reference);
              result = passage(reference);
            }
          } catch {
            result = { error: "Invalid tool arguments." };
          }
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }
      const result = {
        id,
        repeat,
        effort,
        status,
        durationMs: Date.now() - started,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheTokens,
        cacheWriteTokens,
        cost,
        calls,
        expectedReferencePresent: expected
          ? answer
              .toLowerCase()
              .replace(/psalms/g, "psalm")
              .includes(expected.toLowerCase().replace(/psalms/g, "psalm"))
          : null,
        answer,
      };
      results.push(result);
      await writeFile(
        `${outputDir}/results.json`,
        JSON.stringify(
          {
            model: "gpt-5.6-luna",
            priceDate: "2026-09-13",
            totalCost,
            scope:
              "Current SureWord system prompt and exact local KJV passage retrieval. Excludes authenticated route, background work, search, audio and storage.",
            results,
          },
          null,
          2,
        ),
      );
      console.log(JSON.stringify({ ...result, answer: undefined }));
      if (
        status === "budget_limit" ||
        status.startsWith("error:401") ||
        status.startsWith("error:403")
      )
        process.exit(1);
    }
  }
}
console.log(
  JSON.stringify({
    complete: true,
    turns: results.length,
    totalCost,
    outputDir,
  }),
);
