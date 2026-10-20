import assert from "node:assert/strict";
import test from "node:test";
import { nativeRouteAlias } from "../src/lib/native-route-alias.ts";

function target(section, path, query = {}) {
  const result = nativeRouteAlias(section, path.split("/").filter(Boolean), query);
  assert.ok(result, `${section}/${path} resolves`);
  return new URL(result, "https://sureword.app");
}

test("native daily links retain canonical web destinations and chapter context", () => {
  const destinations = { cross: "/cross", plan: "/bible/plan", learn: "/bible/learn", history: "/bible/history", chapter: "/bible/chapter" };
  for (const [page, destination] of Object.entries(destinations)) {
    const result = target("today", page, { book: "43", chapter: "3", verse: "16", translation: "BSB" });
    assert.equal(result.pathname, destination);
    assert.equal(result.searchParams.get("translation"), "BSB");
    assert.equal(result.searchParams.get("book"), "43");
    assert.equal(result.searchParams.get("verse"), "16");
  }
});

test("native note IDs become the existing web editor selection without losing filters", () => {
  assert.equal(target("study", "notes").pathname, "/notes");
  const result = target("study", "notes/note 1", { folder: "folder-7", note: "older", tag: ["hope", "prayer"] });
  assert.equal(result.pathname, "/notes");
  assert.equal(result.searchParams.get("note"), "note 1");
  assert.equal(result.searchParams.get("folder"), "folder-7");
  assert.deepEqual(result.searchParams.getAll("tag"), ["hope", "prayer"]);
});

test("study links retain sermons, chapter scope, and timeline search", () => {
  assert.equal(target("study", "sermons").pathname, "/sermons");
  assert.equal(target("study", "sermon", { id: "study-1" }).pathname, "/sermons/study-1");
  assert.equal(target("study", "sermons/study-2").pathname, "/sermons/study-2");
  assert.equal(target("study", "chapter", { book: "1", chapter: "2", translation: "NKJV" }).searchParams.get("translation"), "NKJV");
  assert.equal(target("study", "timeline", { q: "Paul & Silas", mode: "people" }).searchParams.get("q"), "Paul & Silas");
});

test("native and legacy atlas links select the actual entity, event, or journey", () => {
  for (const section of ["study", "bible-atlas"]) {
    const prefix = section === "study" ? "atlas/" : "";
    assert.equal(target(section, prefix).pathname, "/bible/timeline");
    assert.equal(target(section, `${prefix}abraham`).searchParams.get("detail"), "person:abraham");
    assert.equal(target(section, `${prefix}jerusalem`, { kind: "place" }).searchParams.get("detail"), "place:jerusalem");
    assert.equal(target(section, `${prefix}event/exodus`).searchParams.get("detail"), "event:exodus");
    assert.equal(target(section, `${prefix}family/abraham`).searchParams.get("detail"), "person:abraham");
    const journey = target(section, `${prefix}trace/paul`, { detail: "person:old", era: "apostles" });
    assert.equal(journey.searchParams.get("personId"), "paul");
    assert.equal(journey.searchParams.get("detail"), null);
    assert.equal(journey.searchParams.get("era"), "apostles");
  }
});

test("aliases never interpret IDs or unknown paths as another host or route", () => {
  const note = target("study", "notes", { note: "a/b?next=https://elsewhere.example" });
  assert.equal(note.origin, "https://sureword.app");
  assert.equal(note.pathname, "/notes");
  const sermon = target("study", "sermon", { id: "../private?x=1" });
  assert.equal(sermon.pathname, "/sermons/..%2Fprivate%3Fx%3D1");
  assert.equal(nativeRouteAlias("today", ["unknown"], {}), null);
  assert.equal(nativeRouteAlias("today", ["toString"], {}), null);
  assert.equal(nativeRouteAlias("study", ["sermon"], { id: ".." }), null);
  assert.equal(nativeRouteAlias("study", ["words"], {}), null, "specific word-study page owns its own route");
  assert.equal(nativeRouteAlias("study", ["notes", "id", "extra"], {}), null);
  assert.equal(nativeRouteAlias("study", ["atlas", "event", "id", "extra"], {}), null);
});
