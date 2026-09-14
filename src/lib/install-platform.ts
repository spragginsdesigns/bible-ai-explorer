export type InstallPlatform = "windows" | "android" | "macos" | "ios" | "other";

export function detectInstallPlatform(userAgent: string, platform = "", maxTouchPoints = 0): InstallPlatform {
  if (/android/i.test(userAgent) || /android/i.test(platform)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || (/mac/i.test(userAgent + platform) && (maxTouchPoints > 1 || /mobile/i.test(userAgent)))) return "ios";
  if (/windows|win32|win64/i.test(userAgent + platform)) return "windows";
  if (/macintosh|macintel|macos|mac os x/i.test(userAgent + platform)) return "macos";
  return "other";
}

export interface PwaInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Browser prompts are single-use, including when two clicks arrive together. */
export async function consumeInstallPrompt(holder: { current: PwaInstallPrompt | null }) {
  const prompt = holder.current;
  holder.current = null;
  if (!prompt) return "unavailable" as const;
  try {
    await prompt.prompt();
    return (await prompt.userChoice).outcome;
  } catch {
    return "unavailable" as const;
  }
}
