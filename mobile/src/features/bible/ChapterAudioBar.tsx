import React, { useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { useTheme } from "@/features/settings/settingsStore";
import { formatClock, formatListenRate } from "@/features/cross/listen";
import type { useChapterAudio } from "./useChapterAudio";

export function ChapterAudioBar({ audio, reference }: { audio: ReturnType<typeof useChapterAudio>; reference: string }) {
  const { colors } = useTheme();
  const progressWidth = useRef(1);
  if (!audio.open) return null;
  const icon = (name: React.ComponentProps<typeof Ionicons>["name"], label: string, action: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={action} style={[styles.button, disabled && { opacity: 0.4 }]}>
      <Ionicons name={name} color={colors.text} size={24} />
    </Pressable>
  );
  return <View style={[styles.bar, { backgroundColor: colors.bgElevated, borderColor: colors.borderStrong }]}>
    <View style={styles.row}>
      <Text style={{ color: colors.text, flex: 1 }}>{reference}{audio.verse ? ` · ${audio.verse}` : ""}</Text>
      {icon("close", "Close narration", audio.stop)}
    </View>
    {audio.error ? <View style={styles.row}><Text accessibilityRole="alert" style={{ color: colors.danger, flex: 1 }}>{audio.error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry narration" onPress={() => void audio.play(audio.verse ?? 0)} style={styles.button}><Text style={{ color: colors.accent }}>Retry</Text></Pressable></View> : null}
    {audio.stillListeningPrompt ? <View style={styles.row}>
      <Text style={{ color: colors.text, flex: 1 }}>Still listening?</Text>
      <Pressable accessibilityRole="button" onPress={audio.keepListening} style={styles.button}><Text style={{ color: colors.accent }}>Keep listening</Text></Pressable>
    </View> : <View style={styles.row}>
      {icon("play-skip-back", "Previous verse", () => audio.skipVerse(-1), !audio.ready)}
      {icon(audio.playing ? "pause" : "play", audio.playing ? "Pause narration" : "Play narration", audio.toggle, !audio.ready)}
      {icon("play-skip-forward", "Next verse", () => audio.skipVerse(1), !audio.ready)}
      <Text style={{ color: colors.textMuted, flex: 1 }}>{audio.ready ? formatClock(audio.elapsed) : "Loading…"} / {formatClock(audio.audio?.duration ?? 0)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${formatListenRate(audio.rate)}`} onPress={audio.cycleRate} style={styles.button}><Text style={{ color: colors.accent }}>{formatListenRate(audio.rate)}</Text></Pressable>
    </View>}
    <View style={styles.row}>
      {icon("play-back", "Back ten seconds", () => audio.seek(audio.elapsed - 10), !audio.ready)}
      <View accessibilityRole="adjustable" accessibilityLabel="Narration progress"
        accessibilityValue={{ min: 0, max: Math.round(audio.audio?.duration ?? 0), now: Math.round(audio.elapsed) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={e => audio.seek(audio.elapsed + (e.nativeEvent.actionName === "increment" ? 10 : -10))}
        style={styles.progress} onLayout={e => { progressWidth.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => audio.ready}
        onResponderRelease={e => audio.seek((e.nativeEvent.locationX / Math.max(1, progressWidth.current)) * (audio.audio?.duration ?? 0))}>
        <View style={{ height: 4, backgroundColor: colors.borderStrong }}><View style={{ height: 4, backgroundColor: colors.accent, width: `${Math.min(100, audio.elapsed / (audio.audio?.duration || 1) * 100)}%` }} /></View>
      </View>
      {icon("play-forward", "Forward ten seconds", () => audio.seek(audio.elapsed + 10), !audio.ready)}
    </View>
  </View>;
}
const styles = StyleSheet.create({ bar: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, button: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, progress: { flex: 1, minHeight: 44, justifyContent: "center" } });
