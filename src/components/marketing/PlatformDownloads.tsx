"use client";

import { trackNativeDownload } from "@/lib/analytics/client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import { consumeInstallPrompt, detectInstallPlatform, type InstallPlatform, type PwaInstallPrompt } from "@/lib/install-platform";
import styles from "./platform-downloads.module.css";

export default function PlatformDownloads({ initialPlatform = "other" }: { initialPlatform?: InstallPlatform }) {
  const [platform, setPlatform] = useState(initialPlatform);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<"windows" | "ios" | "web" | null>(null);
  const [message, setMessage] = useState("");
  const prompt = useRef<PwaInstallPrompt | null>(null);
  const installedRef = useRef(false);
  const helpId = useId();

  useEffect(() => {
    const browser = navigator as Navigator & { userAgentData?: { platform?: string }; standalone?: boolean };
    setPlatform(detectInstallPlatform(browser.userAgent, browser.userAgentData?.platform ?? browser.platform, browser.maxTouchPoints));
    const standalone = matchMedia("(display-mode: standalone)");
    const updateInstalled = () => { installedRef.current = standalone.matches || browser.standalone === true; setInstalled(installedRef.current); };
    const capture = (event: Event) => { event.preventDefault(); prompt.current = event as PwaInstallPrompt; };
    const complete = () => { prompt.current = null; installedRef.current = true; setInstalled(true); setHelp(null); setMessage(""); };
    updateInstalled();
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    standalone.addEventListener("change", updateInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
      standalone.removeEventListener("change", updateInstalled);
    };
  }, []);

  const showWindows = () => { setMessage(""); setHelp("windows"); };
  const install = async () => {
    if (busy) return;
    setMessage("");
    if (platform === "ios") { setHelp("ios"); return; }
    setBusy(true);
    const outcome = await consumeInstallPrompt(prompt);
    setBusy(false);
    if (outcome === "accepted") { setHelp(null); if (!installedRef.current) setMessage("Follow your browser’s installation steps."); }
    else if (outcome === "dismissed") setMessage("You can install later or keep studying in your browser.");
    else setHelp(platform === "windows" ? "windows" : "web");
  };
  const native = platform === "android" || platform === "macos";

  return (
    <div className={styles.downloads} aria-label="Get SureWord for your device">
      {installed ? <p className={styles.installed}>SureWord is installed.</p> : native ? (
        <a className={styles.recommended} href={platform === "android" ? ANDROID_APK_URL : MACOS_DMG_URL} onClick={() => trackNativeDownload(platform === "android" ? "android" : "macos", "landing-primary")}>
          <Download size={15} /> Get for {platform === "android" ? "Android" : "macOS"}
        </a>
      ) : (
        <button type="button" className={styles.recommended} onClick={() => void install()} disabled={busy} aria-expanded={help !== null} aria-controls={helpId}>
          <Download size={15} /> {busy ? "Opening…" : platform === "windows" ? "Get for Windows" : platform === "ios" ? "Add to Home Screen" : "Install web app"}
        </button>
      )}
      {!installed && <p className={styles.caption}>{platform === "windows" ? "Windows web app · installs from your browser." : platform === "android" ? "Android app · direct APK download." : platform === "macos" ? "Native macOS app." : "Your study, in its own app window."}</p>}
      <div className={styles.alternatives}>
        <span>Other devices:</span>
        {platform !== "windows" && <button type="button" onClick={showWindows} aria-expanded={help === "windows"} aria-controls={helpId}>Windows</button>}
        {platform !== "android" && <a href={ANDROID_APK_URL} onClick={() => trackNativeDownload("android", "landing-secondary")}>Android <ArrowUpRight size={12} /></a>}
        {platform !== "macos" && <a href={MACOS_DMG_URL} onClick={() => trackNativeDownload("macos", "landing-secondary")}>macOS <ArrowUpRight size={12} /></a>}
      </div>
      <p className={styles.caption}>Or study right here on the web.</p>
      <div id={helpId}>
        {help && <div className={styles.help} role="region" aria-label="Installation instructions">
          <strong>{help === "windows" ? "Install on Windows" : help === "ios" ? "Add SureWord to your Home Screen" : "Install the web app"}</strong>
          <p>{help === "ios" ? "Open sureword.app in Safari. Tap Share, then Add to Home Screen. Choose Open as Web App if offered, then tap Add." : help === "windows" ? "Open sureword.app in Microsoft Edge or Chrome on Windows and select the install icon in the address bar. In Edge, you can also open the menu, then More tools → Apps → Install this site as an app." : "Open sureword.app in a browser that supports app installation, such as Edge or Chrome, then select the install icon in the address bar. You can also keep using SureWord in this tab."}</p>
          <button type="button" onClick={() => setHelp(null)}>Close instructions</button>
        </div>}
      </div>
      {message && <p className={styles.caption} role="status">{message}</p>}
      <noscript><p className={styles.caption}>Windows: open sureword.app in Edge or Chrome and use the install icon in the address bar.</p></noscript>
    </div>
  );
}
