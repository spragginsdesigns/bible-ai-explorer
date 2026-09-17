"use client";

import { useEffect, useState } from "react";
import { Download, Laptop, Smartphone } from "lucide-react";
import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import { detectInstallPlatform, type InstallPlatform } from "@/lib/install-platform";

const downloads = {
  android: { label: "Android", description: "Android app · APK", href: ANDROID_APK_URL, Icon: Smartphone, color: "text-emerald-700 dark:text-emerald-400", interaction: "hover:border-emerald-600/50 hover:bg-emerald-50 active:bg-emerald-100 focus-visible:outline-emerald-700 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-400/10 dark:active:bg-emerald-400/15 dark:focus-visible:outline-emerald-400" },
  macos: { label: "Mac", description: "macOS app · DMG", href: MACOS_DMG_URL, Icon: Laptop, color: "text-sky-700 dark:text-sky-400", interaction: "hover:border-sky-600/50 hover:bg-sky-50 active:bg-sky-100 focus-visible:outline-sky-700 dark:hover:border-sky-400/40 dark:hover:bg-sky-400/10 dark:active:bg-sky-400/15 dark:focus-visible:outline-sky-400" },
};

export default function SharedDownloads() {
  const [platform, setPlatform] = useState<InstallPlatform>("other");
  useEffect(() => {
    const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
    setPlatform(detectInstallPlatform(browser.userAgent, browser.userAgentData?.platform ?? browser.platform, browser.maxTouchPoints));
  }, []);
  const order: (keyof typeof downloads)[] = platform === "macos" ? ["macos", "android"] : ["android", "macos"];

  return (
    <div className="mt-6 border-t border-amber-900/10 pt-5 dark:border-amber-200/10">
      <p className="mb-3 text-metadata text-neutral-600 dark:text-neutral-400">Take SureWord with you</p>
      <div className="grid gap-3 min-[480px]:grid-cols-2">
        {order.map((key) => {
          const { label, description, href, Icon, color, interaction } = downloads[key];
          return (
            <a key={key} href={href} className={`group flex min-h-16 items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ${interaction}`}>
              <Icon aria-hidden="true" className={`h-6 w-6 shrink-0 ${color}`} strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block text-control font-semibold">Download for {label}</span>
                <span className="mt-0.5 block text-metadata text-neutral-600 dark:text-neutral-400">{description}</span>
                {platform === key && <span className={`mt-1 block text-metadata font-semibold ${color}`}>For your device</span>}
              </span>
              <Download aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
