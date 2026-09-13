import assert from "node:assert/strict";
import test from "node:test";
import { resolveBillingReturnOrigin } from "../src/lib/billing/return-origin.ts";

test("live payments always return to the canonical app", () => {
  assert.equal(
    resolveBillingReturnOrigin(undefined, false),
    "https://sureword.app",
  );
  assert.throws(() =>
    resolveBillingReturnOrigin("https://another.example", false),
  );
  assert.throws(() =>
    resolveBillingReturnOrigin("http://localhost:3108", false),
  );
});
test("sandbox payments can return to a local or HTTPS preview", () => {
  assert.equal(
    resolveBillingReturnOrigin("http://localhost:3108", true),
    "http://localhost:3108",
  );
  assert.equal(
    resolveBillingReturnOrigin("https://preview.example/", true),
    "https://preview.example",
  );
});
test("credentials, paths, queries and unsafe schemes are rejected", () => {
  for (const url of [
    "https://user:pass@sureword.app",
    "https://sureword.app/other",
    "https://sureword.app/?next=other",
    "https://sureword.app/#other",
    "http://another.example",
    "file:///tmp",
    "javascript:alert(1)",
  ])
    assert.throws(() => resolveBillingReturnOrigin(url, true));
});
