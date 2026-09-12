import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { getKjvChapter } from "@/features/bible/kjv";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { isOfflineMessage, type GetToken } from "@/lib/api";
import { fetchLearnToday, reviewLearnCard } from "./api";
import { applyReview, parseCard, parseToday, verseWords, type LearnToday } from "./learn";

export default function LearnScreen() {
 const { userId, isLoaded } = useAuth();
 if (!isLoaded || !userId) return <Screen><Text>Sign in to learn your verses.</Text></Screen>;
 return <LearnSession key={userId} userId={userId} />;
}
function LearnSession({ userId }: { userId: string }) {
 const { getToken } = useAuth();
 const token: GetToken = useCallback(options => getToken({ skipCache: options?.fresh }), [getToken]);
 const router = useRouter();
 const { colors } = useTheme();
 const styles = useThemedStyles(createStyles);
 const [today, setToday] = useState<LearnToday | null>(null);
 const [revealed, setRevealed] = useState<Set<number>>(new Set());
 const [offline, setOffline] = useState(false);
 const [busy, setBusy] = useState(false);
 const [needsReload, setNeedsReload] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const operation = useRef(false);
 const mounted = useRef(true);
 const touch = useRef<{x:number; y:number} | null>(null);
 const cacheKey = "sureword:learn:v1:" + userId;
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 const cache = useCallback(async (data: LearnToday) => {
  // A storage failure must not turn a successful server review into a retry.
  await AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => undefined);
 }, [cacheKey]);
 const load = useCallback(async () => {
  if (operation.current) return;
  operation.current = true; setBusy(true); setError(null);
  try {
   const data = parseToday(await fetchLearnToday(token));
   await cache(data);
   if (mounted.current) { setToday(data); setOffline(false); setNeedsReload(false); setRevealed(new Set()); }
  } catch (e) {
   let cached: LearnToday | null = null;
   if (isOfflineMessage(e)) {
    try { const stored = await AsyncStorage.getItem(cacheKey); if (stored) cached = parseToday(JSON.parse(stored)); } catch { /* Ignore invalid cached data. */ }
   }
   if (mounted.current) {
    if (cached) { setToday(cached); setOffline(true); setNeedsReload(false); setRevealed(new Set()); }
    else { setError(isOfflineMessage(e) ? "Connect once to download your verses for offline practice." : "Learn is not available. Please try again."); setNeedsReload(true); }
   }
  } finally { operation.current = false; if (mounted.current) setBusy(false); }
 }, [cache, cacheKey, token]);
 useEffect(() => { void load(); }, [load]);
 const card = today?.cards[0];
 let text = card?.text ?? "";
 // Only replace KJV with bundled KJV. Never relabel another translation.
 if (card?.translation === "KJV") {
  try { text = getKjvChapter(card.book, card.chapter)[card.verse - 1] || text; } catch { /* Use the server-resolved text already cached. */ }
 }
 const words = card ? verseWords(text, card.stage) : [];
 const review = async (result: "again" | "good") => {
  if (!card || !today || operation.current || needsReload) return;
  if (offline) {
   // Rehearsal only. No durable review queue until the API supports deduplication.
   const finished = result === "good" && card.stage === 3;
   const stage = result === "again" ? 1 : Math.min(3, card.stage + 1) as 0|1|2|3;
   setToday({ ...today, cards: finished ? today.cards.slice(1) : today.cards.map(x => x.id === card.id ? {...x, stage} : x) });
   setRevealed(new Set()); return;
  }
  operation.current = true; setBusy(true); setError(null);
  try {
   const updated = parseCard(await reviewLearnCard(token, card.id, result));
   const next = applyReview(today, card, updated, result);
   await cache(next);
   if (mounted.current) { setToday(next); setRevealed(new Set()); }
  } catch {
   if (mounted.current) { setError("Your review may have been saved. Reload before continuing."); setNeedsReload(true); }
  } finally { operation.current = false; if (mounted.current) setBusy(false); }
 };
 const disabled = busy || needsReload;
 return <Screen edges={["top","bottom"]}><ScrollView contentContainerStyle={styles.content}>
  <View style={styles.header}>
   <Pressable accessibilityRole="button" accessibilityLabel="Back to Bible" onPress={() => router.replace("/(app)/bible")} style={styles.back}><Text style={styles.link}>‹ Bible</Text></Pressable>
   <Text style={styles.title}>Learn a verse</Text>
   {today && <Text style={styles.count}>{today.knownCount} verses you know</Text>}
  </View>
  {offline && <View style={styles.notice}><Text style={styles.muted}>Offline practice. Your saved schedule will not change.</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()} style={styles.back}><Text style={styles.link}>Reconnect</Text></Pressable></View>}
  {error && <View accessibilityRole="alert" style={styles.notice}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()} style={styles.back}><Text style={styles.link}>Reload verses</Text></Pressable></View>}
  {!today && !error && <Text style={styles.empty}>Loading your verses...</Text>}
  {today && !card && <View style={styles.study}><Text style={styles.emptyTitle}>{today.queueCount ? "Today's practice is complete." : "Start with a verse you want to remember."}</Text><Text style={styles.hint}>{today.queueCount ? "Your next verses will be ready when they are due." : "Choose Learn this verse from the Bible reader or a highlight."}</Text></View>}
  {card && <View style={styles.study}
   onTouchStart={e => { touch.current = {x:e.nativeEvent.pageX,y:e.nativeEvent.pageY}; }}
   onTouchEnd={e => { const start=touch.current; touch.current=null; if (start && start.x-e.nativeEvent.pageX > 70 && Math.abs(start.y-e.nativeEvent.pageY)<45 && card.stage<3) void review("good"); }}>
   <Text style={styles.reference}>{card.reference} · {card.translation}</Text>
   <Text style={styles.verse}>{words.map((word,index) => <Text key={index} style={styles.verse}>{index ? " " : ""}{word.hidden && !revealed.has(index) ?
    <Text accessibilityRole="button" accessibilityLabel={"Reveal word " + (index+1)} onPress={disabled ? undefined : () => setRevealed(old => new Set(old).add(index))} style={[styles.verse,styles.blank]}>{word.blank}</Text> : word.text}</Text>)}</Text>
   <Text style={styles.hint}>{card.stage === 0 ? "Read the verse, then continue." : card.stage === 3 ? "Say the verse from its reference. Tap a blank for help." : "Recall the missing words. Tap a blank for help, then continue."}</Text>
   <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={() => void review("again")} style={[styles.button,disabled && styles.disabled]}><Text style={styles.buttonText}>Practice again</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={() => void review("good")} style={[styles.button,{backgroundColor:colors.accent},disabled && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Saving..." : card.stage === 3 ? (offline ? "Finish practice" : "I remembered") : "Continue"}</Text></Pressable>
   </View>
  </View>}
 </ScrollView></Screen>;
}
const createStyles = (c: Colors) => StyleSheet.create({
 content:{flexGrow:1,padding:spacing.xl,gap:spacing.lg},
 header:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
 back:{minHeight:44,justifyContent:"center",paddingHorizontal:spacing.sm},
 link:{color:c.accent,fontSize:15,fontFamily:fonts.bodyBold},
 title:{color:c.text,fontSize:16,fontFamily:fonts.bodyBold},
 count:{color:c.textMuted,fontSize:13},
 notice:{borderWidth:1,borderColor:c.borderStrong,borderRadius:radius.lg,padding:spacing.md},
 muted:{color:c.textMuted,fontSize:15,lineHeight:22},
 study:{flex:1,justifyContent:"center",paddingVertical:spacing.xl},
 reference:{color:c.accent,fontFamily:fonts.bodyBold,textAlign:"center",fontSize:16,marginBottom:spacing.xl},
 verse:{color:c.text,fontFamily:fonts.verse,fontSize:30,lineHeight:44,textAlign:"center"},
 blank:{color:c.accent,textDecorationLine:"underline"},
 hint:{color:c.textMuted,fontSize:14,lineHeight:21,textAlign:"center",marginTop:spacing.xl},
 actions:{flexDirection:"row",gap:spacing.md,marginTop:spacing.xl},
 button:{flex:1,minHeight:48,borderWidth:1,borderColor:c.borderStrong,borderRadius:radius.lg,padding:spacing.md,alignItems:"center",justifyContent:"center"},
 buttonText:{color:c.text,fontFamily:fonts.bodyBold,textAlign:"center"},
 primaryText:{color:"#111",fontFamily:fonts.bodyBold,textAlign:"center"},
 disabled:{opacity:0.5},
 empty:{color:c.textMuted,textAlign:"center",marginVertical:spacing.xl},
 emptyTitle:{color:c.text,fontFamily:fonts.verse,fontSize:28,lineHeight:36,textAlign:"center"},
});


