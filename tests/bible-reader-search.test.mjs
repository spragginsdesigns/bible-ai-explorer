import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const books = JSON.parse(read("../src/data/books.json"));
const job = JSON.parse(read("../src/data/kjv/18-job.json"));
const row = { translation: "NKJV", book: 18, chapter: 1, verse: 8,
  text: "a <mark>blameless and upright</mark> man, one who fears God and shuns evil?" };

function load(client, fetcher) {
  const path = client === "web" ? "../src/lib/bible/" : "../mobile/src/features/bible/";
  // Execute each client's real KJV search loop against its bundled Job text.
  const kjvSource = read(`${path}kjv.ts`).slice(read(`${path}kjv.ts`).indexOf("export " + (client === "web" ? "async " : "") + "function searchKjv("));
  const searchKjv = new Function("BOOKS", "getKjvBook", `${stripTypeScriptTypes(kjvSource.replace(/^export /gm, ""))}; return searchKjv;`)([{ order: 18 }], () => job);
  const source = read(`${path}search.ts`).replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "");
  return new Function("searchKjv", "bookByOrder", "fetch", `${stripTypeScriptTypes(source)}; return searchBible;`)(searchKjv, (order) => books.find((book) => book.order === order), fetcher);
}

for (const client of ["web", "android"]) {
  test(`${client}: modern phrase falls back from bundled KJV to NKJV Job 1:8`, async () => {
    let requested;
    const search = load(client, async (url) => { requested = new URL(url); return { ok: true, json: async () => ({ results: [row] }) }; });
    const result = await search("  blameless   and upright  ", "KJV");
    assert.equal(result.translation, "NKJV");
    assert.equal(result.hits[0].verse, 8);
    assert.equal(result.hits[0].translation, "NKJV");
    assert.equal(result.hits[0].text.includes("<mark>"), false);
    assert.equal(requested.searchParams.get("search"), "blameless and upright");
    assert.equal(requested.searchParams.get("match_whole"), "true");
  });

  test(`${client}: KJV matches stay offline and retain their translation`, async () => {
    const result = await load(client, () => { throw new Error("Must stay offline"); })("perfect and an upright man", "KJV");
    assert.equal(result.translation, "KJV");
    assert.ok(result.hits.some((hit) => hit.chapter === 1 && hit.verse === 8));
  });

  test(`${client}: selected NKJV is searched first`, async () => {
    const result = await load(client, async () => ({ ok: true, json: async () => ({ results: [row] }) }))("blameless and upright", "NKJV");
    assert.equal(result.hits[0].translation, "NKJV");
  });

  test(`${client}: failed or malformed responses cannot masquerade as no matches`, async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ error: "unavailable" }) },
      { ok: true, json: async () => ({ results: [{ ...row, translation: "KJV" }] }) }]) {
      await assert.rejects(load(client, async () => response)("blameless and upright", "KJV"));
    }
  });

  test(`${client}: a real miss checks both translations`, async () => {
    const result = await load(client, async () => ({ ok: true, json: async () => ({ results: [] }) }))("zzzznonexistent", "NKJV");
    assert.deepEqual(result.hits, []);
  });

  test(`${client}: empty and cancelled queries make no network requests`, async () => {
    const search = load(client, () => { throw new Error("Unexpected fetch"); });
    assert.deepEqual((await search(" ", "NKJV")).hits, []);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(search("blameless and upright", "NKJV", 100, controller.signal));
  });

  test(`${client}: live provider finds Job 1:8 from the reported phrase`, { skip: !process.env.LIVE_BIBLE_SEARCH }, async () => {
    const result = await load(client, fetch)("blameless and upright", "KJV");
    assert.ok(result.hits.some((hit) => hit.order === 18 && hit.chapter === 1 && hit.verse === 8 && hit.translation === "NKJV"));
  });
}
