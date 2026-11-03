import { describe, expect, it, vi } from "vitest";
import { ConsentGate, type ConsentDocument, type ConsentTransport } from "./aiConsentGate";

const agreed: ConsentDocument = { aiConsent: { version: 2, acceptedAt: "2026-11-03T00:00:00Z" } };
const refused: ConsentDocument = { aiConsent: null, aiConsentDeclined: true };
const transport = (doc = agreed): ConsentTransport => ({
  isCurrentAccount: () => true,
  load: vi.fn(async () => doc),
  save: vi.fn(async () => doc),
});
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("consent transport registrations", () => {
  it("keeps the newest registration when an older shell releases", async () => {
    const gate = new ConsentGate();
    const older = gate.registerTransport("reader/session", transport());
    const newer = gate.registerTransport("reader/session", transport());
    const session = gate.sessionId;
    older.release(); await tick();
    expect(gate.sessionId).toBe(session);
    expect(older.isActive()).toBe(false);
    expect(newer.isActive()).toBe(true);
    expect(await gate.ensure()).toBe(true);
    newer.release();
    expect(gate.isCurrentAccount()).toBe(false);
    expect(gate.allowed).toBe(false);
  });

  it("restores a live older registration, with a new session and real saved refusal", async () => {
    const gate = new ConsentGate(); const olderTransport = transport(refused);
    const older = gate.registerTransport("reader/session", olderTransport);
    const newer = gate.registerTransport("reader/session", transport());
    await tick(); expect(gate.allowed).toBe(true);
    const session = gate.sessionId;
    newer.release();
    expect(gate.sessionId).toBeGreaterThan(session);
    expect(gate.allowed).toBe(false);
    expect(older.isActive()).toBe(true);
    await tick();
    expect(await gate.ensure()).toBe(false);
    expect(olderTransport.load).toHaveBeenCalledTimes(2);
    expect(gate.getSnapshot().prompt).toBe(false);
    older.release();
    expect(gate.isCurrentAccount()).toBe(false);
  });

  it("never restores registrations from a previous owner or session, even with a stale true predicate", () => {
    for (const nextScope of ["other-reader/session", "reader/new-session"]) {
      const gate = new ConsentGate();
      const older = gate.registerTransport("reader/session", transport());
      const newer = gate.registerTransport(nextScope, transport());
      newer.release();
      expect(older.isActive()).toBe(false);
      expect(gate.isCurrentAccount()).toBe(false);
      older.release();
    }
  });

  it("does not restore an older registration whose live identity became invalid", () => {
    const gate = new ConsentGate(); let current = true;
    const older = gate.registerTransport("reader/session", { ...transport(), isCurrentAccount: () => current });
    const newer = gate.registerTransport("reader/session", transport());
    current = false; newer.release();
    expect(older.isActive()).toBe(false);
    expect(gate.isCurrentAccount()).toBe(false);
  });

  it("ignores an old owner's delayed agreement after the next owner's refusal loads", async () => {
    const gate = new ConsentGate(); let finish!: (doc: ConsentDocument) => void;
    gate.registerTransport("reader/session", { ...transport(), load: () => new Promise(resolve => { finish = resolve; }) });
    const next = gate.registerTransport("other-reader/session", transport(refused));
    await tick(); finish(agreed); await tick();
    expect(next.isActive()).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(await gate.ensure()).toBe(false);
    expect(gate.getSnapshot().declined).toBe(true);
  });

  it("ignores the removed newest shell's delayed agreement after restoring the older refusal", async () => {
    const gate = new ConsentGate(); let finish!: (doc: ConsentDocument) => void;
    const older = gate.registerTransport("reader/session", transport(refused));
    const newer = gate.registerTransport("reader/session", { ...transport(), load: () => new Promise(resolve => { finish = resolve; }) });
    newer.release(); await tick(); finish(agreed); await tick();
    expect(older.isActive()).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(await gate.ensure()).toBe(false);
  });

  it("does not grant the next owner an agreement saved by a released registration", async () => {
    const gate = new ConsentGate(); let finish!: (doc: ConsentDocument) => void;
    gate.registerTransport("reader/session", {
      ...transport({ aiConsent: null, aiConsentDeclined: false }), askOnLaunch: true,
      save: () => new Promise(resolve => { finish = resolve; }),
    });
    await tick(); expect(gate.getSnapshot().prompt).toBe(true);
    const saving = gate.agree();
    gate.registerTransport("other-reader/session", transport(refused));
    await tick(); finish(agreed); await saving;
    expect(gate.allowed).toBe(false);
    expect(gate.getSnapshot().declined).toBe(true);
    expect(await gate.ensure()).toBe(false);
  });
});
