import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import { RADAR } from "@/constants/radar-theme";
import { formatDistance } from "@/lib/radar/geo";
import { toScreenBearing } from "@/lib/radar/course";
import type { HazardView } from "@/lib/nasa/hazard-view";
import type { EnrichedContact, OrientationMode } from "@/lib/radar/types";

interface RadarScopeProps {
  contacts: EnrichedContact[];
  hazards?: HazardView[];
  rangeM: number;
  thresholdM: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  orientationMode: OrientationMode;
  courseHeadingDeg: number | null;
  connecting?: boolean;
}

function polar(cx: number, cy: number, radius: number, degrees: number) {
  // Bearings are true/geographic: 0° north, increasing clockwise.
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: cx + Math.cos(radians) * radius,
    y: cy + Math.sin(radians) * radius,
  };
}

function sectorPath(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polar(cx, cy, radius, startDeg);
  const end = polar(cx, cy, radius, endDeg);
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 0 0 ${end.x} ${end.y} Z`;
}

function diamondPath(x: number, y: number, radius: number): string {
  return `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`;
}

function trianglePath(x: number, y: number, radius: number): string {
  return `M ${x} ${y - radius} L ${x + radius * 0.87} ${y + radius * 0.5} L ${x - radius * 0.87} ${y + radius * 0.5} Z`;
}

function directionArrowPath(cx: number, cy: number, radius: number, degrees: number): string {
  const tip = polar(cx, cy, radius, degrees);
  const base = polar(cx, cy, radius - 9, degrees);
  const left = polar(base.x, base.y, 3.3, degrees + 90);
  const right = polar(base.x, base.y, 3.3, degrees - 90);
  return `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`;
}

export function RadarScope({
  contacts,
  hazards = [],
  rangeM,
  thresholdM,
  selectedId,
  onSelect,
  orientationMode,
  courseHeadingDeg,
  connecting = false,
}: RadarScopeProps) {
  const [size, setSize] = useState(320);
  const [pulse, setPulse] = useState(false);
  const [rotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    rotation.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 360,
        duration: 4800,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  useEffect(() => {
    const timer = setInterval(() => setPulse((value) => !value), 900);
    return () => clearInterval(timer);
  }, []);

  const cx = size / 2;
  const cy = size / 2;
  const radius = Math.max(40, size / 2 - 24);
  const safeRange = Math.max(1, rangeM);
  const orientationDeg =
    orientationMode === "course" ? (courseHeadingDeg ?? 0) : 0;

  const ticks = useMemo(() => {
    return Array.from({ length: 72 }, (_, index) => {
      const angle = toScreenBearing(index * 5, orientationDeg);
      const major = index % 6 === 0;
      const inner = radius - (major ? 10 : 5);
      const start = polar(cx, cy, inner, angle);
      const end = polar(cx, cy, radius, angle);
      return {
        key: `tick-${index}`,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        major,
      };
    });
  }, [cx, cy, orientationDeg, radius]);

  const sweepSegments = useMemo(() => {
    const segments = 12;
    const step = 3.6;
    return Array.from({ length: segments }, (_, index) => ({
      key: `sweep-${index}`,
      d: sectorPath(cx, cy, radius, -index * step, -(index + 1) * step),
      opacity: Math.max(0.015, 0.17 * (1 - index / segments)),
    }));
  }, [cx, cy, radius]);

  const rings = useMemo(
    () =>
      Array.from({ length: 4 }, (_, index) => {
        const fraction = (index + 1) / 4;
        return {
          key: `ring-${index}`,
          r: radius * fraction,
          label: formatDistance(safeRange * fraction),
        };
      }),
    [radius, safeRange],
  );

  const thresholdRadius = Math.min(radius, (thresholdM / safeRange) * radius);
  const thresholdLabel = polar(cx, cy, thresholdRadius, 225);
  const northPosition = polar(cx, cy, radius + 12, toScreenBearing(0, orientationDeg));
  const eastPosition = polar(cx, cy, radius + 12, toScreenBearing(90, orientationDeg));
  const southPosition = polar(cx, cy, radius + 12, toScreenBearing(180, orientationDeg));
  const westPosition = polar(cx, cy, radius + 12, toScreenBearing(270, orientationDeg));
  const northArrow = directionArrowPath(
    cx,
    cy,
    radius - 1,
    toScreenBearing(0, orientationDeg),
  );
  const axisNorth = polar(cx, cy, radius, toScreenBearing(0, orientationDeg));
  const axisSouth = polar(cx, cy, radius, toScreenBearing(180, orientationDeg));
  const axisEast = polar(cx, cy, radius, toScreenBearing(90, orientationDeg));
  const axisWest = polar(cx, cy, radius, toScreenBearing(270, orientationDeg));
  const shownContacts = contacts.filter(
    (contact) => contact.distanceM <= safeRange,
  );
  const shownHazards = hazards.filter((hazard) => hazard.isVisible);
  const rotate = rotation.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });

  const handleLayout = (width: number) => {
    const next = Math.round(width);
    if (next > 0 && Math.abs(next - size) > 1) setSize(next);
  };

  return (
    <View
      style={styles.wrap}
      onLayout={(event) => handleLayout(event.nativeEvent.layout.width)}
    >
      <Svg width={size} height={size} style={styles.svg}>
        <Defs>
          <RadialGradient id="scopeBg" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#0B1D26" stopOpacity="1" />
            <Stop offset="0.72" stopColor="#071119" stopOpacity="1" />
            <Stop offset="1" stopColor="#04070B" stopOpacity="1" />
          </RadialGradient>
        </Defs>

        <Circle cx={cx} cy={cy} r={radius} fill="url(#scopeBg)" />
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={RADAR.colors.cyan}
          strokeOpacity={0.42}
          strokeWidth={1.2}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={radius - 4}
          fill="none"
          stroke={RADAR.colors.cyan}
          strokeOpacity={0.1}
          strokeWidth={1}
        />

        {ticks.map((tick) => (
          <Line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={RADAR.colors.cyan}
            strokeOpacity={tick.major ? 0.5 : 0.2}
            strokeWidth={tick.major ? 1.2 : 0.8}
          />
        ))}

        {rings.map((ring) => (
          <G key={ring.key}>
            <Circle
              cx={cx}
              cy={cy}
              r={ring.r}
              fill="none"
              stroke={RADAR.colors.cyan}
              strokeOpacity={0.13}
              strokeWidth={1}
              strokeDasharray="2 5"
            />
            <Rect
              x={cx + 5}
              y={cy - ring.r + 2}
              width={Math.max(30, ring.label.length * 5.2 + 7)}
              height={11}
              rx={2}
              fill={RADAR.colors.bg}
              fillOpacity={0.72}
            />
            <SvgText
              x={cx + 9}
              y={cy - ring.r + 11}
              fill={RADAR.colors.muted}
              fontFamily={RADAR.fonts.mono}
              fontSize={8}
            >
              {ring.label}
            </SvgText>
          </G>
        ))}

        <Line
          x1={axisWest.x}
          y1={axisWest.y}
          x2={axisEast.x}
          y2={axisEast.y}
          stroke={RADAR.colors.cyan}
          strokeOpacity={0.16}
          strokeWidth={1}
        />
        <Line
          x1={axisNorth.x}
          y1={axisNorth.y}
          x2={axisSouth.x}
          y2={axisSouth.y}
          stroke={RADAR.colors.cyan}
          strokeOpacity={0.16}
          strokeWidth={1}
        />

        {thresholdRadius > 2 ? (
          <G>
            <Circle
              cx={cx}
              cy={cy}
              r={thresholdRadius}
              fill="none"
              stroke={RADAR.colors.red}
              strokeOpacity={0.5}
              strokeWidth={1.2}
              strokeDasharray="5 5"
            />
            <SvgText
              x={thresholdLabel.x}
              y={thresholdLabel.y}
              fill={RADAR.colors.redSoft}
              fillOpacity={0.75}
              fontFamily={RADAR.fonts.mono}
              fontSize={7}
              textAnchor="middle"
            >
              UMBRAL
            </SvgText>
          </G>
        ) : null}

        <SvgText
          x={northPosition.x}
          y={northPosition.y + 4}
          fill={RADAR.colors.cyan}
          fontFamily={RADAR.fonts.displaySemi}
          fontSize={11}
          textAnchor="middle"
        >
          N
        </SvgText>
        <Path d={northArrow} fill={RADAR.colors.cyan} />
        <SvgText
          x={eastPosition.x}
          y={eastPosition.y + 4}
          fill={RADAR.colors.cyan}
          fontFamily={RADAR.fonts.displaySemi}
          fontSize={11}
          textAnchor="middle"
        >
          E
        </SvgText>
        <SvgText
          x={southPosition.x}
          y={southPosition.y + 4}
          fill={RADAR.colors.cyan}
          fontFamily={RADAR.fonts.displaySemi}
          fontSize={11}
          textAnchor="middle"
        >
          S
        </SvgText>
        <SvgText
          x={westPosition.x}
          y={westPosition.y + 4}
          fill={RADAR.colors.cyan}
          fontFamily={RADAR.fonts.displaySemi}
          fontSize={11}
          textAnchor="middle"
        >
          O
        </SvgText>

        <Circle
          cx={cx}
          cy={cy}
          r={8}
          fill="none"
          stroke={RADAR.colors.cyan}
          strokeOpacity={0.45}
          strokeWidth={1}
        />
        <Circle cx={cx} cy={cy} r={3.2} fill={RADAR.colors.cyan} />
        <SvgText
          x={cx}
          y={cy + 19}
          fill={RADAR.colors.cyanDim}
          fontFamily={RADAR.fonts.mono}
          fontSize={7}
          textAnchor="middle"
        >
          TÚ
        </SvgText>

        {shownHazards.map((hazard) => {
          const point = polar(
            cx,
            cy,
            (hazard.distanceM / safeRange) * radius,
            toScreenBearing(hazard.bearingDeg, orientationDeg),
          );
          const color = hazard.isNear
            ? RADAR.colors.amberSoft
            : RADAR.colors.amber;
          return (
            <G key={`hazard-${hazard.id}`}>
              <Circle
                cx={point.x}
                cy={point.y}
                r={hazard.isNear ? 11 : 8}
                fill="none"
                stroke={color}
                strokeOpacity={hazard.isNear ? 0.55 : 0.3}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <Path
                d={trianglePath(point.x, point.y, 5.5)}
                fill={color}
                stroke={RADAR.colors.bg}
                strokeWidth={1.2}
              />
            </G>
          );
        })}

        {shownContacts.map((contact) => {
          const point = polar(
            cx,
            cy,
            (contact.distanceM / safeRange) * radius,
            toScreenBearing(contact.bearingDeg, orientationDeg),
          );
          const selected = contact.id === selectedId;
          const color = selected
            ? RADAR.colors.text
            : contact.isNear
              ? RADAR.colors.red
              : RADAR.colors.green;
          const ringRadius = (contact.isNear ? 10 : 8) + (pulse ? 3 : 0);

          return (
            <G key={contact.id}>
              {selected ? (
                <Line
                  x1={cx}
                  y1={cy}
                  x2={point.x}
                  y2={point.y}
                  stroke={RADAR.colors.cyanSoft}
                  strokeOpacity={0.8}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              ) : null}
              <Circle
                cx={point.x}
                cy={point.y}
                r={ringRadius}
                fill="none"
                stroke={color}
                strokeOpacity={contact.isNear ? (pulse ? 0.25 : 0.6) : 0.22}
                strokeWidth={1}
              />
              {contact.uas ? (
                <Path
                  d={diamondPath(point.x, point.y, 6.5)}
                  fill={color}
                  stroke={RADAR.colors.bg}
                  strokeWidth={1.4}
                />
              ) : (
                <Circle
                  cx={point.x}
                  cy={point.y}
                  r={5}
                  fill={color}
                  stroke={RADAR.colors.bg}
                  strokeWidth={1.4}
                />
              )}
              {selected ? (
                <Circle
                  cx={point.x}
                  cy={point.y}
                  r={16}
                  fill="none"
                  stroke={RADAR.colors.text}
                  strokeOpacity={0.65}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              ) : null}
              {selected ? (
                <SvgText
                  x={point.x + 14}
                  y={point.y - 12}
                  fill={RADAR.colors.text}
                  fontFamily={RADAR.fonts.mono}
                  fontSize={9}
                >
                  {contact.callsign}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>

      {/* Align the sweep to course; its animated rotation stays independent. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.sweep,
          {
            width: size,
            height: size,
            transform: [{ rotate: `${-orientationDeg}deg` }, { rotate }],
          },
        ]}
      >
        <Svg width={size} height={size}>
          {sweepSegments.map((segment) => (
            <Path
              key={segment.key}
              d={segment.d}
              fill={RADAR.colors.cyan}
              fillOpacity={segment.opacity}
            />
          ))}
          <Line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - radius}
            stroke={RADAR.colors.cyanSoft}
            strokeOpacity={0.95}
            strokeWidth={1.6}
          />
          <Circle
            cx={cx}
            cy={cy - radius}
            r={2.6}
            fill={RADAR.colors.cyanSoft}
          />
        </Svg>
      </Animated.View>

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => onSelect(null)}
          accessibilityRole="button"
          accessibilityLabel="Deseleccionar contacto"
        />
        {shownContacts.map((contact) => {
          const point = polar(
            cx,
            cy,
            (contact.distanceM / safeRange) * radius,
            toScreenBearing(contact.bearingDeg, orientationDeg),
          );
          return (
            <Pressable
              key={`hit-${contact.id}`}
              onPress={() => onSelect(contact.id)}
              accessibilityRole="button"
              accessibilityLabel={`Seleccionar ${contact.callsign}, ${formatDistance(
                contact.distanceM,
              )}`}
              style={[
                styles.hitArea,
                { left: point.x - 18, top: point.y - 18 },
              ]}
            />
          );
        })}
      </View>

      {connecting ? (
        <View style={styles.connecting} pointerEvents="none">
          <ActivityIndicator size="small" color={RADAR.colors.cyan} />
          <Text style={styles.connectingTitle}>ADQUIRIENDO SEÑAL</Text>
          <Text style={styles.connectingSub}>OPEN SKY // ADS-B</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    aspectRatio: 1,
    position: "relative",
  },
  svg: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  sweep: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  hitArea: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  connecting: {
    position: "absolute",
    alignSelf: "center",
    top: "42%",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(4, 7, 11, 0.9)",
    borderWidth: 1,
    borderColor: RADAR.colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  connectingTitle: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 11,
    letterSpacing: 1.6,
    color: RADAR.colors.cyan,
  },
  connectingSub: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: RADAR.colors.muted,
  },
});
