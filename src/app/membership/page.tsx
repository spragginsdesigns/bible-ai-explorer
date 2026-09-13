"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  PRO_MONTHLY_PRICE_CENTS,
  PRO_MONTHLY_MESSAGES,
  PRO_DAILY_MESSAGES,
} from "@/lib/billing/plans";

type Membership = {
  plan: "free" | "pro";
  owner: boolean;
  access: "house" | "keys";
  hasPersonalKeys: boolean;
  enabled: boolean;
  checkoutAvailable: boolean;
  subscription: {
    status: string;
    periodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  usage: {
    dailyRemaining: number;
    monthlyRemaining: number | null;
    day: { end: string };
    month: { end: string };
  } | null;
};

export default function MembershipPage() {
  const [data, setData] = useState<Membership | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/billing/status", {
        cache: "no-store",
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!signal?.aborted) {
        setData(result);
        setError("");
      }
      return result as Membership;
    } catch (error) {
      if (signal?.aborted) return;
      setError(
        error instanceof Error ? error.message : "Could not load membership.",
      );
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const returnedFromCheckout =
      new URLSearchParams(window.location.search).get("checkout") === "success";
    setPaymentPending(returnedFromCheckout);
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const refresh = async () => {
      const result = await load(controller.signal);
      if (controller.signal.aborted) return;
      if (result?.plan === "pro" || result?.owner) setPaymentPending(false);
      else if (returnedFromCheckout && ++attempts < 20)
        timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load]);
  const openBilling = async (kind: "checkout" | "portal") => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/billing/${kind}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      )
        throw new Error("Unexpected billing destination.");
      window.location.assign(url.href);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not open billing.",
      );
      setBusy(false);
    }
  };
  const chooseAccess = async (access: "house" | "keys") => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update AI choice.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-[#101410] px-5 py-9 pb-28 text-[#f3efe3]">
      <div className="mx-auto max-w-3xl">
        {paymentPending && (
          <p
            role="status"
            className="mb-5 rounded-lg border border-[#d9b878]/30 p-4 text-sm text-[#d9b878]"
          >
            Waiting for payment confirmation. Your membership updates after the
            payment provider confirms it.{" "}
            <button
              className="underline"
              onClick={() =>
                void load().then((result) => {
                  if (result?.plan === "pro") setPaymentPending(false);
                })
              }
            >
              Refresh membership
            </button>
          </p>
        )}
        <Link
          href="/"
          className="mb-10 inline-flex items-center gap-2 text-sm text-[#b6bcb0]"
        >
          <ArrowLeft size={16} />
          Back to study
        </Link>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d9b878]">
          Your SureWord membership
        </p>
        <h1
          className="my-4 text-5xl"
          style={{ fontFamily: "var(--font-cormorant), Georgia, serif" }}
        >
          Room to keep growing.
        </h1>
        <p className="mb-8 max-w-xl leading-7 text-[#b6bcb0]">
          Your Bible, notes, highlights and saved conversations stay with you,
          whatever membership you choose.
        </p>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-300/30 p-4 text-sm text-red-200"
          >
            {error}
            <button onClick={() => void load()} className="ml-3 underline">
              Reload
            </button>
          </div>
        )}
        {!data && !error && <p role="status">Loading membership…</p>}
        {data && (
          <>
            <section className="mb-6 rounded-2xl border border-white/15 bg-white/[0.03] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl">
                  {data.owner
                    ? "Owner access"
                    : data.plan === "pro"
                      ? "SureWord Pro"
                      : "SureWord Free"}
                </h2>
                <span className="text-sm text-[#d9b878]">
                  {data.owner
                    ? "Owner AI access"
                    : data.access === "keys"
                      ? "Personal API key"
                      : "Included AI"}
                </span>
              </div>
              {data.owner ? (
                <p className="mt-3 text-sm text-[#b6bcb0]">
                  All paid benefits and configured models are available to your
                  account without a subscription.
                </p>
              ) : data.usage ? (
                <div className="mt-5 flex flex-wrap gap-8">
                  <div>
                    <strong className="text-3xl">
                      {data.usage.dailyRemaining}
                    </strong>
                    <p className="mt-1 text-sm text-[#b6bcb0]">
                      included messages left today
                    </p>
                    <p className="mt-2 text-xs text-[#b6bcb0]">
                      Resets {new Date(data.usage.day.end).toLocaleString()}
                    </p>
                  </div>
                  {data.usage.monthlyRemaining !== null && (
                    <div>
                      <strong className="text-3xl">
                        {data.usage.monthlyRemaining}
                      </strong>
                      <p className="mt-1 text-sm text-[#b6bcb0]">
                        left in this billing period
                      </p>
                      <p className="mt-2 text-xs text-[#b6bcb0]">
                        Resets {new Date(data.usage.month.end).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#b6bcb0]">
                  Continue studying free. Pro memberships are coming soon.
                </p>
              )}
              {data.subscription && (
                <>
                  <p className="mt-5 text-sm text-[#b6bcb0]">
                    {data.subscription.cancelAtPeriodEnd
                      ? "Paid access ends"
                      : "Current billing period ends"}{" "}
                    {new Date(data.subscription.periodEnd).toLocaleDateString()}
                    .
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void openBilling("portal")}
                    className="mt-4 rounded-lg border border-white/20 px-4 py-3 text-sm disabled:opacity-50"
                  >
                    Manage billing
                  </button>
                </>
              )}
            </section>
            {data.enabled && !data.owner && (
              <section className="mb-6 rounded-2xl border border-white/15 p-6">
                <h2 className="text-lg">Choose who pays for AI</h2>
                <p className="mt-2 text-sm leading-6 text-[#b6bcb0]">
                  Included AI uses your SureWord allowance. A personal API key
                  uses your provider account and keeps your included messages
                  available.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {(["house", "keys"] as const).map((access) => (
                    <button
                      key={access}
                      disabled={
                        busy || (access === "keys" && !data.hasPersonalKeys)
                      }
                      aria-pressed={data.access === access}
                      onClick={() => void chooseAccess(access)}
                      className={`rounded-lg border px-4 py-3 text-sm disabled:opacity-40 ${data.access === access ? "border-[#d9b878] bg-[#d9b878]/10 text-[#d9b878]" : "border-white/20"}`}
                    >
                      {access === "house" ? "Included AI" : "My API key"}
                    </button>
                  ))}
                </div>
                <Link
                  href="/settings"
                  className="mt-4 inline-block text-sm text-[#d9b878] underline"
                >
                  Manage personal keys in Settings
                </Link>
              </section>
            )}
            {!data.owner && data.plan !== "pro" && (
              <section className="rounded-2xl border border-[#d9b878]/50 bg-[#20271e] p-7">
                <p className="text-xs uppercase tracking-widest text-[#d9b878]">
                  SureWord Pro
                </p>
                <p className="my-4 text-5xl">
                  ${PRO_MONTHLY_PRICE_CENTS / 100}
                  <span className="text-base text-[#b6bcb0]"> / month</span>
                </p>
                <ul className="mb-7 grid gap-3 text-sm">
                  {[
                    `${PRO_MONTHLY_MESSAGES} AI messages each billing month`,
                    `Up to ${PRO_DAILY_MESSAGES} messages per day`,
                    "Thoughtful, Scripture-grounded AI",
                    "Keep using your personal keys whenever you prefer",
                  ].map((text) => (
                    <li key={text} className="flex items-center gap-2">
                      <Check size={16} className="text-[#d9b878]" />
                      {text}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void openBilling("checkout")}
                  disabled={busy || !data.checkoutAvailable}
                  className="flex items-center gap-5 rounded-lg bg-[#d9b878] px-5 py-3 font-semibold text-[#172017] disabled:opacity-50"
                >
                  {busy
                    ? "Opening…"
                    : data.checkoutAvailable
                      ? "Continue to secure checkout"
                      : "Pro checkout opens soon"}
                  <ArrowRight size={17} />
                </button>
                <p className="mt-3 text-xs leading-6 text-[#b6bcb0]">
                  Renews monthly until canceled. Review the full total and any
                  applicable taxes in checkout.{" "}
                  <Link className="underline" href="/terms">
                    Membership terms
                  </Link>
                  .
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
