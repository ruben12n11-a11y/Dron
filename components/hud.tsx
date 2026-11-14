import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { RADAR } from "@/constants/radar-theme";

export function Page({
  children,
  edges = ["top", "left", "right"],
}: {
  children: ReactNode;
  edges?: Edge[];
}) {
  return (
    <View style={styles.page}>
      <SafeAreaView edges={edges} style={styles.safeArea}>
        <View style={styles.pageInner}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {right}
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.rule}>
        <View style={styles.ruleAccent} />
      </View>
    </View>
  );
}

export function CornerBrackets({
  color = RADAR.colors.borderStrong,
  size = 9,
}: {
  color?: string;
  size?: number;
}) {
  const base = {
    position: "absolute" as const,
    width: size,
    height: size,
    borderColor: color,
  };
  return (
    <>
      <View
        pointerEvents="none"
        style={[base, { top: -1, left: -1, borderTopWidth: 1, borderLeftWidth: 1 }]}
      />
      <View
        pointerEvents="none"
        style={[base, { top: -1, right: -1, borderTopWidth: 1, borderRightWidth: 1 }]}
      />
      <View
        pointerEvents="none"
        style={[base, { bottom: -1, left: -1, borderBottomWidth: 1, borderLeftWidth: 1 }]}
      />
      <View
        pointerEvents="none"
        style={[base, { bottom: -1, right: -1, borderBottomWidth: 1, borderRightWidth: 1 }]}
      />
    </>
  );
}

export function HudPanel({
  children,
  style,
  accent = RADAR.colors.borderStrong,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: string;
  padded?: boolean;
}) {
  return (
    <View style={[styles.panel, padded && styles.panelPadded, style]}>
      <CornerBrackets color={accent} />
      {children}
    </View>
  );
}

export function SectionTitle({
  index,
  title,
  right,
}: {
  index: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionIndex}>{index}</Text>
      <Text style={styles.sectionText}>{title}</Text>
      <View style={styles.sectionLine} />
      {right}
    </View>
  );
}

export function Chip({
  label,
  active = false,
  onPress,
  count,
  tone = "cyan",
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  count?: number;
  tone?: "cyan" | "red" | "amber";
}) {
  const toneColor =
    tone === "red"
      ? RADAR.colors.red
      : tone === "amber"
        ? RADAR.colors.amber
        : RADAR.colors.cyan;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        active && {
          borderColor: toneColor,
          backgroundColor:
            tone === "red"
              ? RADAR.colors.redFaint
              : tone === "amber"
                ? RADAR.colors.amberFaint
                : RADAR.colors.cyanFaint,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipText, active && { color: toneColor }]}>
        {label}
        {typeof count === "number" ? ` ${count}` : ""}
      </Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "cyan",
}: {
  label: string;
  tone?: "cyan" | "red" | "green" | "amber" | "muted";
}) {
  const color =
    tone === "red"
      ? RADAR.colors.red
      : tone === "green"
        ? RADAR.colors.green
        : tone === "amber"
          ? RADAR.colors.amber
          : tone === "muted"
            ? RADAR.colors.muted
            : RADAR.colors.cyan;
  const background =
    tone === "red"
      ? RADAR.colors.redFaint
      : tone === "amber"
        ? RADAR.colors.amberFaint
        : tone === "green"
          ? "rgba(52, 211, 153, 0.10)"
          : tone === "muted"
            ? "rgba(100, 128, 139, 0.12)"
            : RADAR.colors.cyanFaint;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: background }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function MetricTile({
  label,
  value,
  unit,
  tone = "default",
  emphasis = false,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "red" | "cyan" | "amber";
  emphasis?: boolean;
}) {
  const color =
    tone === "red"
      ? RADAR.colors.red
      : tone === "cyan"
        ? RADAR.colors.cyan
        : tone === "amber"
          ? RADAR.colors.amber
          : RADAR.colors.text;
  return (
    <View style={[styles.metric, emphasis && styles.metricEmphasis]}>
      <View style={[styles.metricAccent, { backgroundColor: color }]} />
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricValueRow}>
        <Text
          style={[
            styles.metricValue,
            emphasis && styles.metricValueEmphasis,
            { color },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
      ]}
    >
      {icon}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  tone = "cyan",
}: {
  label: string;
  onPress: () => void;
  tone?: "cyan" | "red" | "muted";
}) {
  const color =
    tone === "red"
      ? RADAR.colors.red
      : tone === "muted"
        ? RADAR.colors.muted
        : RADAR.colors.cyan;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.ghostButton,
        { borderColor: color },
        pressed && { opacity: 0.65 },
      ]}
    >
      <Text style={[styles.ghostButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function StatusDot({
  color = RADAR.colors.cyan,
  size = 6,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: 0.9,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: RADAR.colors.bg,
  },
  safeArea: {
    flex: 1,
  },
  pageInner: {
    flex: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 20,
  },
  eyebrow: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 10,
    letterSpacing: 1.7,
    color: RADAR.colors.cyanDim,
  },
  title: {
    marginTop: 2,
    fontFamily: RADAR.fonts.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 0.5,
    color: RADAR.colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: RADAR.colors.textDim,
  },
  rule: {
    marginTop: 12,
    height: 1,
    backgroundColor: RADAR.colors.border,
  },
  ruleAccent: {
    width: 54,
    height: 1,
    backgroundColor: RADAR.colors.cyan,
  },
  panel: {
    position: "relative",
    backgroundColor: RADAR.colors.panel,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.md,
  },
  panelPadded: {
    padding: 12,
  },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sectionIndex: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 10,
    color: RADAR.colors.cyan,
    letterSpacing: 1,
  },
  sectionText: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: RADAR.colors.textDim,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: RADAR.colors.border,
  },
  chip: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    color: RADAR.colors.textDim,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.9,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: 6,
    backgroundColor: RADAR.colors.panel,
    overflow: "hidden",
  },
  metricEmphasis: {
    flex: 1.35,
    backgroundColor: RADAR.colors.panelRaised,
  },
  metricAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 18,
    height: 2,
    opacity: 0.8,
  },
  metricLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1.1,
    color: RADAR.colors.muted,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
    marginTop: 2,
  },
  metricValue: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 0.2,
  },
  metricValueEmphasis: {
    fontSize: 26,
    lineHeight: 29,
  },
  metricUnit: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    color: RADAR.colors.muted,
  },
  primaryButton: {
    height: 44,
    borderRadius: 6,
    backgroundColor: RADAR.colors.cyan,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 1.4,
    color: RADAR.colors.bgDeep,
  },
  ghostButton: {
    height: 36,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  ghostButtonText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
  },
});
