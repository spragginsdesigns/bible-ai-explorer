import React, { useCallback, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useUser } from "@clerk/expo";
import { getAvailablePurchases as getStorePurchases, useIAP, type Purchase } from "expo-iap";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { apiJson, type GetToken } from "@/lib/api";
import { useThemedStyles } from "./settingsStore";
import { spacing, radius, typography, type Colors } from "@/theme";
import { completePlayPurchase } from "./googlePlayPurchase";

type Membership = {
  plan: "free" | "pro";
  owner: boolean;
  enabled: boolean;
  access: "house" | "keys";
  hasPersonalKeys: boolean;
  playCheckoutAvailable?: boolean;
  playSubscriptionManagementUrl?: string | null;
  subscription?: { provider?: string; status?: string; cancelAtPeriodEnd?: boolean } | null;
  usage: {
    dailyRemaining: number;
    monthlyRemaining: number | null;
    day: { end: string };
  } | null;
};

/** Store-neutral membership and payer controls. Native purchase UI is a separate store integration. */
export function MembershipSection({ getToken }: { getToken: GetToken }) {
  const styles = useThemedStyles(createStyles);
  const [data, setData] = useState<Membership | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      setBusy(false);
      void apiJson<Membership>(getToken, "/api/billing/status")
        .then((value) => {
          if (generation.current === current) {
            setData(value);
            setError("");
          }
        })
        .catch(() => {
          if (generation.current === current)
            setError("Membership details are temporarily unavailable.");
        });
      return () => {
        generation.current++;
      };
    }, [getToken]),
  );
  const choose = async (access: "house" | "keys") => {
    if (busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await apiJson<Membership>(getToken, "/api/billing/status", {
        method: "PATCH",
        body: { access },
      });
      if (generation.current === current) setData(value);
    } catch (error) {
      if (generation.current === current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not change AI choice.",
        );
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  return (
    <GlassCard>
      <View style={styles.content}>
        <Text style={styles.title}>
          {data?.owner
            ? "Owner membership"
            : data?.plan === "pro"
              ? "SureWord Pro"
              : "Membership & included AI"}
        </Text>
        {data?.owner ? (
          <Text style={styles.body}>
            All paid benefits and configured models are available without a
            subscription.
          </Text>
        ) : data?.usage ? (
          <>
            <Text style={styles.balance}>
              {data.usage.dailyRemaining} messages left today
            </Text>
            {data.usage.monthlyRemaining !== null && (
              <Text style={styles.body}>
                {data.usage.monthlyRemaining} left this billing period
              </Text>
            )}
            <Text style={styles.body}>
              Daily reset: {new Date(data.usage.day.end).toLocaleString()}
            </Text>
          </>
        ) : (
          <Text style={styles.body}>
            {data
              ? "Continue studying free. Pro memberships are coming soon."
              : "Loading membership…"}
          </Text>
        )}
        {data?.enabled && !data.owner && (
          <>
            <Text style={styles.body}>
              Included AI uses your SureWord allowance. Personal keys are billed
              by your provider.
            </Text>
            <View style={styles.options}>
              {(["house", "keys"] as const).map((access) => (
                <Pressable
                  key={access}
                  disabled={
                    busy || (access === "keys" && !data.hasPersonalKeys)
                  }
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: data.access === access,
                    disabled:
                      busy || (access === "keys" && !data.hasPersonalKeys),
                  }}
                  onPress={() => void choose(access)}
                  style={[
                    styles.option,
                    data.access === access && styles.selected,
                    (busy || (access === "keys" && !data.hasPersonalKeys)) &&
                      styles.disabled,
                  ]}
                >
                  <Text style={styles.optionText}>
                    {access === "house" ? "Included AI" : "My API key"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {Platform.OS === "android" && data?.playCheckoutAvailable && !data.owner ? (
          <AndroidPlayBilling getToken={getToken} canBuy={data.plan !== "pro"} onVerified={() => {
            const current = generation.current;
            void apiJson<Membership>(getToken, "/api/billing/status").then(value => {
              if (generation.current === current) setData(value);
            }).catch(() => undefined);
          }} />
        ) : null}
        {data?.subscription?.provider === "google-play" && (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://play.google.com/store/account/subscriptions?sku=sureword_pro&package=com.spragginsdesigns.sureword").catch(() => setError("Google Play could not be opened."))}>
            <Text style={styles.body}>Manage Google Play subscription</Text>
          </Pressable>
        )}
        <Text style={styles.body}>
          Your Bible, notes, highlights and saved study remain available when
          your AI allowance runs out.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </GlassCard>
  );
}

function AndroidPlayBilling({
  getToken,
  canBuy,
  onVerified,
}: {
  getToken: GetToken;
  canBuy: boolean;
  onVerified: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { user } = useUser();
  const userId = user?.id;
  const finishRef = useRef<((params: { purchase: Purchase; isConsumable?: boolean }) => Promise<void>) | null>(null);
  const processing = useRef(new Map<string, Promise<"verified" | "pending" | "ignored">>());
  const verifyAndFinish = (purchase: Purchase) => {
    const key = purchase.purchaseToken ?? purchase.id;
    const existing = processing.current.get(key);
    if (existing) return existing;
    const operation = completePlayPurchase(purchase,
      p => verifyGooglePlayPurchase(getToken, userId, p),
      async p => {
        if (!finishRef.current) throw new Error("Google Play is still connecting. Restore this purchase again shortly.");
        await finishRef.current({ purchase: p, isConsumable: false });
      },
    ).finally(() => processing.current.delete(key));
    processing.current.set(key, operation);
    return operation;
  };
  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    finishTransaction,
  } = useIAP({
    onPurchaseSuccess: (purchase) => {
      setBusy(true);
      void verifyAndFinish(purchase)
        .then(result => {
          if (result === "pending") setMessage("Purchase pending. Google Play will confirm it shortly.");
          if (result === "verified") {
            setMessage("Your SureWord Pro subscription is active.");
            onVerified();
          }
        })
        .catch(error => setMessage(error instanceof Error ? error.message : "Purchase verification failed."))
        .finally(() => setBusy(false));
    },
    onPurchaseError: (error: { code?: string; message?: string }) => {
      if (error.code !== "user-cancelled") setMessage("Google Play could not complete that purchase.");
      setBusy(false);
    },
    onError: () => {
      setMessage("Google Play is temporarily unavailable.");
      setBusy(false);
    },
  });
  finishRef.current = finishTransaction;

  const product = subscriptions.find(item => item.id === "sureword_pro");
  const load = useCallback(() => {
    if (!connected) return;
    void fetchProducts({ skus: ["sureword_pro"], type: "subs" }).catch(() => setMessage("Google Play is temporarily unavailable."));
  }, [connected, fetchProducts]);
  React.useEffect(load, [load]);

  const buy = async () => {
    if (busy || !product || !canBuy) return;
    setBusy(true); setMessage("");
    try {
      const membership = await apiJson<Membership>(getToken, "/api/billing/status");
      if (membership.plan === "pro") { onVerified(); return; }
      const offer = product.subscriptionOffers?.find(item => item.basePlanIdAndroid === "monthly" && item.offerTokenAndroid);
      if (!offer?.offerTokenAndroid) throw new Error("This subscription is not currently available.");
      await requestPurchase({ type: "subs", request: { google: {
        skus: ["sureword_pro"],
        obfuscatedAccountId: await hashAccountId(userId),
        subscriptionOffers: [{ sku: "sureword_pro", offerToken: offer.offerTokenAndroid }],
      } } });
    } catch (error) {
      if (!(error instanceof Error) || !/cancel/i.test(error.message)) setMessage(error instanceof Error ? error.message : "Purchase could not be started.");
    } finally { if (processing.current.size === 0) setBusy(false); }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const purchases = await getStorePurchases({ includeSuspendedAndroid: false });
      let restored = false;
      for (const purchase of purchases) restored = (await verifyAndFinish(purchase)) === "verified" || restored;
      setMessage(restored ? "Your Google Play subscription is restored." : "No active Google Play subscription was found.");
      if (restored) onVerified();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restore could not be completed.");
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.billing}>
      <Text style={styles.body}>Pro is billed securely through Google Play at the price shown, per month. It renews monthly until canceled. Pro includes 600 AI messages per billing period, up to 50 per day.</Text>
      <Text style={styles.price}>{product?.displayPrice ?? "Pro subscription"}</Text>
      <View style={styles.options}>
        {canBuy && <Pressable disabled={busy || !product} accessibilityRole="button" onPress={() => void buy()} style={[styles.option, (busy || !product) && styles.disabled]}>
          <Text style={styles.optionText}>{busy ? "Waiting for Google Play…" : "Start Pro"}</Text>
        </Pressable>}
        <Pressable disabled={busy} accessibilityRole="button" onPress={() => void restore()} style={[styles.option, busy && styles.disabled]}>
          <Text style={styles.optionText}>Restore purchase</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://sureword.app/terms").catch(() => setMessage("Membership terms could not be opened."))}>
        <Text style={styles.body}>Membership terms</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://sureword.app/privacy").catch(() => setMessage("Privacy policy could not be opened."))}>
        <Text style={styles.body}>Privacy policy</Text>
      </Pressable>
      {message ? <Text accessibilityRole="alert" style={styles.body}>{message}</Text> : null}
    </View>
  );
}

async function hashAccountId(userId: string | undefined): Promise<string> {
  if (!userId) throw new Error("Your account is still loading.");
  const { digestStringAsync, CryptoDigestAlgorithm } = require("expo-crypto") as typeof import("expo-crypto");
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, userId);
}

async function verifyGooglePlayPurchase(
  getToken: GetToken,
  userId: string | undefined,
  purchase: { productId?: string; purchaseToken?: string | null },
): Promise<boolean> {
  if (purchase.productId !== "sureword_pro" || !purchase.purchaseToken) return false;
  const result = await apiJson<{ verified: boolean }>(getToken, "/api/billing/google-play", {
    method: "POST",
    body: {
      purchaseToken: purchase.purchaseToken,
      productId: "sureword_pro",
      obfuscatedAccountId: await hashAccountId(userId),
    },
  });
  return result.verified === true;
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    content: { gap: spacing.md, padding: spacing.lg },
    billing: { gap: spacing.sm },
    title: { ...typography.body, color: c.text, fontWeight: "700" },
    body: { ...typography.support, color: c.textSecondary },
    balance: { ...typography.body, color: c.accent, fontWeight: "700" },
    price: { ...typography.body, color: c.accent, fontWeight: "700" },
    options: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    option: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    selected: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
    optionText: { ...typography.support, color: c.text, fontWeight: "600" },
    disabled: { opacity: 0.45 },
    error: { ...typography.support, color: c.danger },
  });
