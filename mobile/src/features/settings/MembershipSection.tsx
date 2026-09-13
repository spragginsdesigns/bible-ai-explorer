import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { apiJson, type GetToken } from "@/lib/api";
import { useThemedStyles } from "./settingsStore";
import { spacing, radius, typography, type Colors } from "@/theme";

type Membership = {
  plan: "free" | "pro";
  owner: boolean;
  enabled: boolean;
  access: "house" | "keys";
  hasPersonalKeys: boolean;
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

const createStyles = (c: Colors) =>
  StyleSheet.create({
    content: { gap: spacing.md, padding: spacing.lg },
    title: { ...typography.body, color: c.text, fontWeight: "700" },
    body: { ...typography.support, color: c.textSecondary },
    balance: { ...typography.body, color: c.accent, fontWeight: "700" },
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
