"use client";

import Image from "next/image";
import { memo, useEffect, useState } from "react";
import styles from "./GuideMotion.module.css";

export type GuidePhase = "idle" | "thinking" | "answering";
export function guidePhase(streaming: boolean, content: string): GuidePhase {
  return !streaming ? "idle" : content.trim() ? "answering" : "thinking";
}
const labels = {
  idle: "SureWord study companion",
  thinking: "SureWord companion reaching upward in prayer while thinking",
  answering: "SureWord companion raising its page arms in praise while answering",
};
const SureWordGuideAvatar = memo(function SureWordGuideAvatar({
  size = 40, active = false, variant = "message", phase = active ? "thinking" : "idle",
}: { size?: number; active?: boolean; variant?: "message" | "hero"; phase?: GuidePhase }) {
  const [foreground, setForeground] = useState(false);
  const eligible = variant === "hero" || phase !== "idle";
  useEffect(() => {
    if (!eligible) return;
    const update = () => setForeground(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [eligible]);
  return <span role="img" aria-label={labels[phase]}
    className={`${styles.pose} ${eligible && foreground ? styles.moving : ""} ${styles[phase] ?? ""}`}
    style={{ width: size, height: size * 1.2 }}>
    <Image src={`/chat-home/sureword-companion-${phase}.png`} alt="" width={1145} height={1374}
      priority={variant === "hero"} sizes={`${size}px`} style={{ width: size, height: size * 1.2 }} />
  </span>;
});
export default SureWordGuideAvatar;
