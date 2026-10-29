import assert from "node:assert/strict";
import test from "node:test";
import { originalQueryClauses, originalQueryPrefixes, originalQueryTsQuery, originalQueryMatchesTokens, originalSourceTokens } from "../scripts/lib/original-query.mjs";

test("wrapping punctuation and smart quotes preserve the same original-word prefix", () => {
  for (const input of ["θεος", "θεος,", "“θεος”", "θεος:", "(θεος)"]) {
    assert.deepEqual(originalQueryClauses(input), [["θεος"]]);
    assert.equal(originalQueryTsQuery(input), "'θεος':*");
    assert.equal(originalQueryMatchesTokens(["θεος"], originalQueryClauses(input)), true);
  }
  for (const input of ["יהוה", "יהוה,", "“יהוה”"]) assert.deepEqual(originalQueryPrefixes(input), ["יהוה"]);
});

test("apostrophes and internal punctuation preserve adjacency instead of widening to unordered AND", () => {
  for (const input of ["δι'αυτου", "δι’αυτου", "δι,αυτου", "δι/αυτου"]) {
    const clauses = originalQueryClauses(input);
    assert.deepEqual(clauses, [["δι", "αυτου"]]);
    assert.equal(originalQueryTsQuery(input), "('δι':* <-> 'αυτου':*)");
    assert.equal(originalQueryMatchesTokens(["δια", "αυτου"], clauses), true);
    assert.equal(originalQueryMatchesTokens(["δια", "θεος", "αυτου"], clauses), false);
    assert.equal(originalQueryMatchesTokens(["αυτου", "δια"], clauses), false);
  }
  assert.deepEqual(originalQueryClauses("δι’ αυτου"), [["δι"], ["αυτου"]]);
  assert.deepEqual(originalQueryClauses(["δι αυτου"]), [["δι", "αυτου"]]);
});

test("all whitespace clauses remain mandatory and cannot borrow only one requested term", () => {
  const clauses = originalQueryClauses("“θεος,” κοσμον");
  assert.deepEqual(clauses, [["θεος"], ["κοσμον"]]);
  assert.equal(originalQueryTsQuery("“θεος,” κοσμον"), "'θεος':* & 'κοσμον':*");
  assert.equal(originalQueryMatchesTokens(["θεος"], clauses), false);
  assert.equal(originalQueryMatchesTokens(["κοσμον"], clauses), false);
  assert.equal(originalQueryMatchesTokens(["θεος", "τον", "κοσμον"], clauses), true);
});

test("punctuation and mark-only chunks cannot create SQL terms or hide real Unicode words", () => {
  for (const input of ["!!!", "“”", "🙏\uFE0F", "\u0301", ["!!!", "\uFE0F"]]) {
    assert.deepEqual(originalQueryClauses(input), []);
    assert.equal(originalQueryTsQuery(input), null);
  }
  assert.deepEqual(originalQueryClauses("🙏\uFE0F θεος !!!"), [["θεος"]]);
  assert.deepEqual(originalQueryClauses("cafe\u0301 愛 कर्म"), [["café"], ["愛"], ["कर्म"]]);
  assert.equal(originalQueryMatchesTokens(["θεος"], originalQueryClauses("θεος 愛")), false);
});

test("source tokens remain exactly the seed normalizer's words, including maqaf and elision", () => {
  assert.deepEqual(originalSourceTokens("Hebrew", [["א־ב", "H1", ""]]), ["א", "ב"]);
  assert.deepEqual(originalSourceTokens("Greek", [["ἀγάπη,", "G26", ""]]), ["αγαπη"]);
  assert.deepEqual(originalSourceTokens("Greek", [["ἀπ’", "G575", ""]]), ["απ"]);
  assert.equal(originalQueryMatchesTokens(originalSourceTokens("Greek", [["ἀπ’", "G575", ""]]), originalQueryClauses("απ’")), true);
  assert.equal(originalQueryMatchesTokens(originalSourceTokens("Hebrew", [["א־ב", "H1", ""]]), originalQueryClauses("א ב")), true);
});

test("SQL operators remain punctuation and every typed word survives as a required safe term", () => {
  assert.equal(originalQueryTsQuery("θεος | !κοσμον"), "'θεος':* & 'κοσμον':*");
  assert.deepEqual(originalQueryPrefixes("θεος'|!κοσμον"), ["θεος", "κοσμον"]);
  assert.equal(originalQueryMatchesTokens(["θεος"], originalQueryClauses("θεος'|!κοσμον")), false);
});
