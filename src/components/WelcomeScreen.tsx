"use client";

import React from "react";
import Image from "next/image";
import { AndroidLogo, AppleLogo } from "./icons/BrandIcons";
import { useSuggestedQuestions } from "./useSuggestedQuestions";
import { buildSuggestedQuestionItems } from "@/utils/questionPresentation";
import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";

interface WelcomeScreenProps {
  onSelectQuestion: (question: string) => void;
}

/** Chip-shaped placeholders while this user's own questions are being drawn. */
const SKELETON_WIDTHS = [82, 68, 90, 74, 61, 86];

type NativeRelease = { version: string; url: string };
type NativeReleases = { android: NativeRelease; macos: NativeRelease };

const FALLBACK_RELEASES: NativeReleases = {
  android: { version: "Latest", url: ANDROID_APK_URL },
  macos: { version: "Latest", url: MACOS_DMG_URL },
};

function isNativeRelease(value: unknown): value is NativeRelease {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NativeRelease>;
  return (
    typeof candidate.version === "string" && typeof candidate.url === "string"
  );
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSelectQuestion }) => {
  const { questions, loading } = useSuggestedQuestions();
  const questionItems = React.useMemo(
    () => buildSuggestedQuestionItems(questions),
    [questions],
  );
  const [releases, setReleases] =
    React.useState<NativeReleases>(FALLBACK_RELEASES);

  React.useEffect(() => {
    let active = true;
    fetch("/api/native-releases", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (!active || !value || typeof value !== "object") return;
        const payload = value as Partial<NativeReleases>;
        setReleases({
          android: isNativeRelease(payload.android)
            ? {
                version: payload.android.version || "Latest",
                url: payload.android.url || ANDROID_APK_URL,
              }
            : FALLBACK_RELEASES.android,
          macos: isNativeRelease(payload.macos)
            ? {
                version: payload.macos.version || "Latest",
                url: payload.macos.url || MACOS_DMG_URL,
              }
            : FALLBACK_RELEASES.macos,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <div className="mb-6">
          <div className="w-20 h-20 rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center mx-auto mb-5 animate-pulse-glow overflow-hidden">
            <Image
              src="/web-app-manifest-512x512.png"
              alt="SureWord"
              width={80}
              height={80}
              priority
              className="w-full h-full object-cover scale-110"
            />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
            SureWord
          </p>
          <h1 className="text-4xl sm:text-6xl font-bold text-neutral-900 dark:text-white mb-3 font-[family-name:var(--font-pirata)]">
            Come hungry for the Word.
          </h1>
          <p className="text-neutral-700 dark:text-neutral-200 text-base leading-7 max-w-xl mx-auto">
            SureWord is your personal Bible study companion, shaped by your
            reading, questions, notes, and daily walk—helping you go deeper in
            Scripture every day.
          </p>
          <figure className="mt-5 max-w-lg mx-auto text-neutral-700 dark:text-neutral-200">
            <blockquote className="text-sm italic leading-6">
              “As newborn babes, desire the sincere milk of the word, that ye
              may grow thereby:”
            </blockquote>
            <figcaption className="mt-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              — 1 Peter 2:2, KJV
            </figcaption>
          </figure>
          <p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-neutral-300 max-w-lg mx-auto">
            Scripture comes first. Every answer is grounded in God&apos;s
            inerrant, infallible Word.
          </p>
        </div>

        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
            CHOSEN FROM YOUR STUDY
          </h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Based on your reading, questions, notes, and daily walk.
          </p>
        </div>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8"
          aria-busy={loading}
          aria-label={
            loading ? "Preparing your questions" : "Suggested questions"
          }
        >
          {loading
            ? SKELETON_WIDTHS.map((width, i) => (
                <div
                  key={i}
                  className="px-4 py-3 rounded-xl gradient-border glass-card"
                  aria-hidden
                >
                  <div
                    className="h-2.5 w-16 animate-pulse rounded-full bg-amber-500/15 dark:bg-amber-400/15"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                  <div
                    className="mt-2 h-4 animate-pulse rounded-full bg-amber-500/15 dark:bg-amber-400/15"
                    style={{
                      width: `${width}%`,
                      animationDelay: `${i * 120}ms`,
                    }}
                  />
                </div>
              ))
            : questionItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => onSelectQuestion(item.question)}
                  className="text-left px-4 py-3 rounded-xl gradient-border glass-card text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-all duration-200 text-sm group animate-message-in"
                >
                  {item.label ? (
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-600/90 dark:text-amber-400/80">
                      {item.label}
                    </span>
                  ) : null}
                  <span className="group-hover:text-neutral-900 dark:group-hover:text-neutral-200 transition-colors">
                    {item.question}
                  </span>
                </button>
              ))}
        </div>

        <div className="mt-8">
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
            ✦ SureWord is also a native app — same account, chats, notes, memories, and daily walk.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={releases.android.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Download SureWord for Android ${releases.android.version}`}
              className="inline-flex w-56 items-center gap-3 rounded-xl gradient-border glass-card px-4 py-2.5 text-left transition-all duration-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:border-amber-500/40 dark:hover:border-amber-400/30"
            >
              <AndroidLogo className="h-7 w-7 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="leading-tight">
                <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                  Download for
                </span>
                <span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
                  Android{" "}
                  <span className="text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/70">
                    {releases.android.version}
                  </span>
                </span>
              </span>
            </a>
            <a
              href={releases.macos.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Download SureWord for macOS ${releases.macos.version}`}
              className="inline-flex w-56 items-center gap-3 rounded-xl gradient-border glass-card px-4 py-2.5 text-left transition-all duration-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:border-amber-500/40 dark:hover:border-amber-400/30"
            >
              <AppleLogo className="h-7 w-7 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="leading-tight">
                <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                  Download for
                </span>
                <span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
                  macOS{" "}
                  <span className="text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/70">
                    {releases.macos.version}
                  </span>
                </span>
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
