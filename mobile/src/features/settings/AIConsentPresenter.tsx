import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { Alert, AppState, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, useClerk } from "@clerk/expo";
import { AppText as Text } from "@/components/AppText";
import { apiJson } from "@/lib/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme } from "./settingsStore";
import * as copy from "@/lib/aiConsent";
import { aiConsentGate, type ConsentDocument } from "@/lib/aiConsentGate";

export function AIConsentPresenter() {
  const { userId, isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const getToken = useStableGetToken();
  const account = useRef(userId); account.current = userId;
  const state = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot);
  const { colors } = useTheme();
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) { aiConsentGate.configure(null); return; }
    const owner = userId;
    const key = `sureword.aiConsent.${owner}`;
    const cache = async (doc: ConsentDocument) => {
      await AsyncStorage.setItem(key, JSON.stringify({ aiConsent: doc.aiConsent, aiConsentRequired: doc.aiConsentRequired }));
    };
    const isCurrentAccount = () => account.current === owner && clerk.user?.id === owner;
    const requireAccount = () => { if (!isCurrentAccount()) throw new Error("Your account changed. Try again."); };
    const ownedToken: typeof getToken = async options => { requireAccount(); const token = await getToken(options); requireAccount(); return token; };
    aiConsentGate.configure({
      isCurrentAccount,
      load: async () => {
        requireAccount();
        try {
          const doc = await apiJson<ConsentDocument>(ownedToken, "/api/preferences");
          requireAccount(); await cache(doc); return doc;
        } catch (error) {
          requireAccount();
          const cached = await AsyncStorage.getItem(key);
          if (cached) return JSON.parse(cached) as ConsentDocument;
          throw error;
        }
      },
      save: async version => {
        requireAccount();
        const doc = await apiJson<ConsentDocument>(ownedToken, "/api/preferences", { method: "PATCH", body: { aiConsent: version === null ? null : { version } } });
        requireAccount(); await cache(doc); return doc;
      },
    });
    const listener = AppState.addEventListener("change", status => { if (status === "active") void aiConsentGate.refresh(); });
    return () => { listener.remove(); aiConsentGate.configure(null); };
  }, [clerk, userId, isLoaded, isSignedIn, getToken]);
  return <Modal visible={state.prompt} transparent animationType="fade" onRequestClose={aiConsentGate.decline}>
    <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.7)" }}>
      <View style={{ maxHeight: "90%", backgroundColor: colors.bgElevated, borderRadius: 16, padding: 24 }}>
        <ScrollView><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24, marginBottom: 16 }}>{copy.AI_CONSENT_TITLE}</Text>
          <Text style={{ color: colors.text, fontSize: 16, lineHeight: 25 }}>{copy.AI_CONSENT_BODY}</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(copy.AI_CONSENT_PRIVACY_URL)} style={{ paddingVertical: 16 }}><Text style={{ color: colors.accent }}>{copy.AI_CONSENT_PRIVACY_LABEL}</Text></Pressable>
        </ScrollView>
        {state.error ? <Text accessibilityRole="alert" style={{ color: colors.danger, marginBottom: 12 }}>{state.error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={state.saving} onPress={() => void aiConsentGate.agree()} style={{ minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: colors.accent, borderRadius: 8 }}><Text style={{ color: colors.bg }}>{state.saving ? "Saving…" : copy.AI_CONSENT_AGREE}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={state.saving} onPress={aiConsentGate.decline} style={{ minHeight: 48, justifyContent: "center", alignItems: "center" }}><Text style={{ color: colors.text }}>{copy.AI_CONSENT_DECLINE}</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

export function AIConsentSettingsRow() {
  const state = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot);
  const { colors } = useTheme();
  const current = state.record?.version === state.required;
  return <View style={{ padding: 16, gap: 8 }}>
    <Text style={{ color: colors.text }}>{copy.AI_CONSENT_SETTINGS_TITLE}</Text>
    <Text style={{ color: colors.textMuted }}>{current ? copy.aiConsentStatusLabel(state.record) : "Not allowed yet"}</Text>
    {state.error && !state.prompt ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{state.error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={state.saving} onPress={() => {
      if (!current) { void aiConsentGate.ensure(true); return; }
      Alert.alert("Withdraw AI data sharing?", "AI features will ask for your permission again. Your study data is kept.", [{ text: "Cancel", style: "cancel" }, { text: copy.AI_CONSENT_WITHDRAW, style: "destructive", onPress: () => void aiConsentGate.withdraw() }]);
    }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: colors.accent }}>{current ? copy.AI_CONSENT_WITHDRAW : "Review and allow"}</Text></Pressable>
  </View>;
}
