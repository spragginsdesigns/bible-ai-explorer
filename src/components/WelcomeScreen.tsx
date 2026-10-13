"use client";

import React from "react";
import Image from "next/image";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import styles from "./ChatHome.module.css";
import SureWordGuideAvatar from "./SureWordGuideAvatar";
import { AndroidLogo, AppleLogo } from "./icons/BrandIcons";
import { useSuggestedQuestions } from "./useSuggestedQuestions";
import { buildSuggestedQuestionItems, parseReferenceLabel } from "@/utils/questionPresentation";
import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import { IosInstallSteps, useInstallPlatform } from "./GetAppLink";

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

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onSelectQuestion,
}) => {
  const { questions, loading, personalized } = useSuggestedQuestions();
  const [showAll, setShowAll] = React.useState(false);
  const questionItems = React.useMemo(
    () => buildSuggestedQuestionItems(questions),
    [questions],
  );
  const [releases, setReleases] =
    React.useState<NativeReleases>(FALLBACK_RELEASES);
  // An APK or DMG does nothing on an iPhone; show the Home Screen steps there.
  const platform = useInstallPlatform();

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

  const visibleItems = showAll ? questionItems : questionItems.slice(0, 4);
  const hiddenCount = Math.max(0, questionItems.length - 4);
  return (
    <div className={styles.welcome}>
      <div className={styles.backdrop} aria-hidden="true">
        <Image src="/chat-home/sureword-sanctuary.png" alt="" fill sizes="(max-width: 768px) 100vw, 768px" priority className={styles.darkArt} />
        <Image src="/chat-home/sureword-sanctuary-light.png" alt="" fill sizes="(max-width: 768px) 100vw, 768px" priority className={styles.lightArt} />
      </div>
      <div className={styles.content}>
        <div className={styles.hero}>
          <SureWordGuideAvatar variant="hero" size={190} />
          <h1>Come hungry for the Word.</h1>
        </div>
        {/* Only claim the user's study when the server says it personalized them;
            the static six are not "chosen" from anything. */}
        <h2 className={styles.sectionHeading}>
          {personalized ? "CHOSEN FROM YOUR STUDY" : "QUESTIONS TO EXPLORE"}
        </h2>
        <div className={styles.questionGrid} aria-busy={loading} aria-label={loading ? "Preparing your questions" : "Suggested questions"}>
          {loading ? SKELETON_WIDTHS.slice(0, 4).map((width, i) => <div key={i} className={styles.skeleton} aria-hidden="true">
            <span style={{ width: `${width}%` }} /><span />
          </div>) : visibleItems.map(item => <button key={item.key} type="button" className={styles.question}
            onClick={() => onSelectQuestion(item.question)}>
            <span>{item.question}</span>
            <span className={styles.tileFooter}>
              <span>{item.label ? parseReferenceLabel(item.label) ?? item.label : ""}</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </span>
          </button>)}
        </div>
        {!loading && !showAll && hiddenCount > 0 && <button type="button" className={styles.more}
          aria-label={`Show ${hiddenCount} more questions${personalized ? " from your study" : ""}`} onClick={() => setShowAll(true)}>
          {hiddenCount} more questions <ChevronDown size={18} aria-hidden="true" />
        </button>}
        {platform === "ios" ? (
          <div className="mx-auto mt-8 max-w-md rounded-xl gradient-border glass-card px-4 py-3">
            <IosInstallSteps />
          </div>
        ) : (
        <div className="mt-8">
          <p className="text-support text-neutral-500 dark:text-neutral-400 mb-3">
            SureWord is also a native app. Same account, chats, notes, memories, and daily walk.
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
                <span className="block text-metadata font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                  Download for
                </span>
                <span className="block text-control font-semibold text-neutral-900 dark:text-neutral-100">
                  Android{" "}
                  <span className="text-metadata font-semibold text-amber-600/80 dark:text-amber-400/70">
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
                <span className="block text-metadata font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
                  Download for
                </span>
                <span className="block text-control font-semibold text-neutral-900 dark:text-neutral-100">
                  macOS{" "}
                  <span className="text-metadata font-semibold text-amber-600/80 dark:text-amber-400/70">
                    {releases.macos.version}
                  </span>
                </span>
              </span>
            </a>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default WelcomeScreen;
