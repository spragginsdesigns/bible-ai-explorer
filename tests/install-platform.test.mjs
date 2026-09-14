import test from "node:test";
import assert from "node:assert/strict";
import { detectInstallPlatform, consumeInstallPrompt } from "../src/lib/install-platform.ts";

test("native downloads match Windows, Android and macOS visitors", () => {
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0"), "windows");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/140.0"), "android");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1"), "macos");
  assert.equal(detectInstallPlatform("", '"Windows"'), "windows");
});

test("iPhones and iPads never receive a macOS download recommendation", () => {
  assert.equal(detectInstallPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148"), "ios");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5), "ios");
});

test("Linux, ChromeOS and unknown clients keep a web-app fallback", () => {
  assert.equal(detectInstallPlatform("Mozilla/5.0 (X11; Linux x86_64)"), "other");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (X11; CrOS x86_64)"), "other");
  assert.equal(detectInstallPlatform(""), "other");
});

test("one browser prompt cannot be reused by concurrent clicks", async () => {
  let calls = 0;
  const holder = { current: { prompt: async () => { calls++; }, userChoice: Promise.resolve({ outcome: "accepted" }) } };
  assert.deepEqual(await Promise.all([consumeInstallPrompt(holder), consumeInstallPrompt(holder)]), ["accepted", "unavailable"]);
  assert.equal(calls, 1);
  assert.equal(holder.current, null);
});

test("dismissal and unsupported prompts preserve the browser-study fallback", async () => {
  assert.equal(await consumeInstallPrompt({ current: null }), "unavailable");
  assert.equal(await consumeInstallPrompt({ current: { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) } }), "dismissed");
  const holder = { current: { prompt: async () => { throw new Error("not available"); }, userChoice: Promise.resolve({ outcome: "accepted" }) } };
  assert.equal(await consumeInstallPrompt(holder), "unavailable");
  assert.equal(holder.current, null);
});
