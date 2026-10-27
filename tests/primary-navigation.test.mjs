import assert from "node:assert/strict";
import test from "node:test";
import { PRIMARY_DESTINATIONS, primarySectionForPath } from "../src/lib/primary-navigation.ts";

test("every primary destination has exactly one owner in the five-section reading order", () => {
  assert.deepEqual(PRIMARY_DESTINATIONS.map(item => item.id), ["today", "bible", "chat", "connections", "study"]);
  assert.equal(new Set(PRIMARY_DESTINATIONS.map(item => item.href)).size, 5);
  for (const destination of PRIMARY_DESTINATIONS) assert.equal(primarySectionForPath(destination.href), destination.id);
});

test("daily practice keeps Today selected on old and new URLs", () => {
  for (const path of ["/today", "/cross", "/bible/cross", "/bible/plan", "/bible/learn", "/bible/history", "/bible/learn/card-1", "/cross?notification=1", "/bible/history#walk", "/serve", "/serve#journal"]) {
    assert.equal(primarySectionForPath(path), "today", path);
  }
});

test("study tools and saved notes belong to Study, without changing their URLs", () => {
  for (const path of ["/study", "/study/words", "/notes", "/notes/note-1", "/bible/timeline", "/bible/timeline?mode=people&book=43&chapter=3", "/bible/atlas", "/sermons", "/sermons/study-1"]) {
    assert.equal(primarySectionForPath(path), "study", path);
  }
});

test("the Bible owns its reader, book grid, translations and search", () => {
  for (const path of ["/bible", "/bible/chapters?book=43", "/bible/chapter?book=43&chapter=3&verse=16&translation=BSB", "/bible/search"]) {
    assert.equal(primarySectionForPath(path), "bible", path);
  }
});

test("Connections remains independent from Chat and Bible for chapter and verse scopes", () => {
  for (const path of ["/connections", "/connections?book=43&chapter=3", "/connections?book=43&chapter=3&verse=16"]) assert.equal(primarySectionForPath(path), "connections", path);
  assert.equal(primarySectionForPath("/?prompt=John+3%3A16&attachTranslation=KJV"), "chat");
});

test("near-prefix and utility routes never select the wrong destination", () => {
  assert.equal(primarySectionForPath("/bible/planet"), "bible");
  assert.equal(primarySectionForPath("/bible/learning"), "bible");
  for (const path of ["/noteworthy", "/study-guide", "/connection", "/settings", "/settings#memory", "/sign-in", "/terms", "/shared/answer-1"]) assert.equal(primarySectionForPath(path), null, path);
});
