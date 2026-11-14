import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import {
  Badge,
  HudPanel,
  MetricTile,
  Page,
  StatusDot,
} from "@/components/hud";
import { ContactDetailCard } from "@/components/radar/ContactDetail";
import { RadarScope } from "@/components/radar/RadarScope";
import { RADAR } from "@/constants/radar-theme";
import { alertColor, alertKindLabel } from "@/lib/radar/alert-meta";
import {
  bearingToCompass,
  formatClockUtc,
  formatCoord,
  formatDistance,
  formatRelative,
} from "@/lib/radar/geo";
import { useRadar } from "@/lib/radar/store";
import type { FeedStatus } from "@/lib/radar/types";

function BrandMark() {
  return (
    <View style={styles.brandMark}>
      <Svg width={36} height={36} viewBox="0 0 36 36">
        <Circle cx={18} cy={18} r={16} stroke={RADAR.colors.cyan} strokeWidth={1} fill="none" opacity={0.55} />
        <Circle cx={18} cy={18} r={10} stroke={RADAR.colors.cyan} strokeWidth={0.6} fill="none" opacity={0.3} />
        <Line x1={18} y1={2} x2={18} y2={34} stroke={RADAR.colors.cyan} strokeWidth={0.6} opacity={0.28} />
        <Line x1={2} y1={18} x2={34} y2={18} stroke={RADAR.colors.cyan} strokeWidth={0.6} opacity={0.28} />
        <Path d="M18 11 L24 18 L18 25 L12 18 Z" fill={RADAR.colors.red} />
        <Circle cx={18} cy={18} r={2} fill={RADAR.colors.text} />
      </Svg>
    </View>
  );
}

function feedColor(status: FeedStatus): string {
  if (status === "live") return RADAR.colors.cyan;
  if (status === "error") return RADAR.colors.red;
  return RADAR.colors.cyanDim;
}

function feedLabel(status: FeedStatus): string {
  if (status === "live") return "ADS-B REAL";
  if (status === "error") return "SIN ENLACE";
  return "CONECTANDO";
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function distanceMetric(meters: number): { value: string; unit: string } {
  if (meters < 1000) {
    return { value: String(Math.round(meters)), unit: "m" };
  }
  if (meters < 10_000) {
    return { value: (meters / 1000).toFixed(1), unit: "km" };
  }
  return { value: String(Math.round(meters / 1000)), unit: "km" };
}

export default function RadarScreen() {
  const router = useRouter();
  const {
    settings,
    visibleContacts,
    alerts,
    feed,
    courseHeadingDeg,
    courseStatus,
    metrics,
    selectedContact,
    selectContact,
    hazards,
  } = useRadar();

  const latestAlert = alerts[0] ?? null;
  const statusColor = feedColor(feed.status);
  const alertAccent = latestAlert
    ? alertColor(latestAlert.severity)
    : RADAR.colors.cyan;
  const thresholdMetric = distanceMetric(settings.thresholdM);
  const rangeMetric = distanceMetric(settings.rangeM);
  const orientationLabel =
    settings.orientationMode === "north"
      ? "NORTE ↑ FIJO"
      : courseStatus === "active" && courseHeadingDeg !== null
        ? `RUMBO ↑ ${String(Math.round(courseHeadingDeg)).padStart(3, "0")}°`
        : courseStatus === "paused"
          ? "RUMBO GPS · EN PAUSA"
          : courseStatus === "error"
            ? "RUMBO GPS · SIN SEÑAL"
            : "RUMBO GPS · ESPERANDO";
  const provenanceTitle =
    feed.status === "live"
      ? "OPEN SKY NETWORK · ADS-B REAL"
      : feed.status === "error"
        ? "ERROR OPEN SKY · CONTACTOS OCULTOS"
        : "VALIDANDO ORIGEN Y FRESCURA DE OPEN SKY";
  const provenanceDetail =
    feed.status === "live" && feed.lastUpdate
      ? `Muestra UTC ${formatClockUtc(feed.lastUpdate)} · ${formatRelative(feed.lastUpdate)}`
      : feed.message;

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandGroup}>
            <BrandMark />
            <View>
              <Text style={styles.brandTitle}>
                DRONE <Text style={styles.brandAccent}>RADAR</Text>
              </Text>
              <Text style={styles.brandSub}>MONITOREO ADS-B · ESTACIÓN MÓVIL</Text>
            </View>
          </View>
          <View style={styles.feedGroup}>
            <View style={[styles.feedPill, { borderColor: statusColor }]}>
              <StatusDot color={statusColor} />
              <Text style={[styles.feedText, { color: statusColor }]}>
                {feedLabel(feed.status)}
              </Text>
            </View>
            <Text style={styles.clock}>
              {feed.lastUpdate ? formatClockUtc(feed.lastUpdate) : "--:--:--"} UTC
            </Text>
          </View>
        </View>

        <View style={styles.stationStrip}>
          <MaterialIcons name="place" size={13} color={RADAR.colors.cyanDim} />
          <Text style={styles.stationLabel}>ESTACIÓN</Text>
          <Text style={styles.stationValue} numberOfLines={1}>
            {formatCoord(settings.ownLat, settings.ownLon)}
          </Text>
          <Text style={styles.stationUpdate}>
            {feed.lastUpdate ? formatRelative(feed.lastUpdate) : "SIN DATOS"}
          </Text>
        </View>

        <View style={styles.provenanceStrip}>
          <MaterialIcons
            name={feed.status === "live" ? "verified" : "satellite-alt"}
            size={15}
            color={statusColor}
          />
          <View style={styles.provenanceText}>
            <Text
              style={[styles.provenanceTitle, { color: statusColor }]}
              numberOfLines={1}
            >
              {provenanceTitle}
            </Text>
            <Text style={styles.provenanceDetail} numberOfLines={1}>
              {provenanceDetail}
            </Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <MetricTile
            label="CONTACTOS"
            value={String(metrics.total)}
            unit="visibles"
            tone="cyan"
            emphasis
          />
          <MetricTile
            label="CERCANOS"
            value={String(metrics.near)}
            unit="bajo umbral"
            tone="red"
          />
          <MetricTile
            label="UMBRAL"
            value={thresholdMetric.value}
            unit={thresholdMetric.unit}
            tone="amber"
          />
          <MetricTile
            label="ALCANCE"
            value={rangeMetric.value}
            unit={rangeMetric.unit}
          />
        </View>

        {metrics.hidden > 0 ? (
          <Text style={styles.hiddenHint}>
            +{metrics.hidden} contacto{metrics.hidden === 1 ? "" : "s"} fuera de
            alcance o filtros
          </Text>
        ) : null}

        <HudPanel style={styles.radarPanel} padded={false} accent={RADAR.colors.cyanDim}>
          <View style={styles.radarTopBar}>
            <Text style={styles.radarMeta}>
              SECTOR 01 // {formatDistance(settings.rangeM)}
            </Text>
            <Text style={styles.radarMeta} numberOfLines={1}>
              {orientationLabel}
            </Text>
          </View>
          <RadarScope
            contacts={visibleContacts}
            hazards={settings.showHazards ? hazards : []}
            rangeM={settings.rangeM}
            thresholdM={settings.thresholdM}
            selectedId={selectedContact?.id ?? null}
            onSelect={selectContact}
            orientationMode={settings.orientationMode}
            courseHeadingDeg={courseHeadingDeg}
            connecting={feed.mode === "connecting" && visibleContacts.length === 0}
          />
          <View style={styles.legendRow}>
            <LegendDot color={RADAR.colors.red} label="CERCANO" />
            <LegendDot color={RADAR.colors.green} label="LEJANO" />
            <View style={styles.legendItem}>
              <View style={[styles.legendDiamond, { backgroundColor: RADAR.colors.red }]} />
              <Text style={styles.legendText}>UAS</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendRing} />
              <Text style={styles.legendText}>UMBRAL</Text>
            </View>
            {settings.showHazards ? (
              <View style={styles.legendItem}>
                <View style={styles.legendTriangle} />
                <Text style={styles.legendText}>NASA</Text>
              </View>
            ) : null}
          </View>
        </HudPanel>

        <Pressable
          onPress={() => router.push("/alerts")}
          accessibilityRole="button"
          accessibilityLabel="Abrir registro de alertas"
          style={({ pressed }) => [styles.ticker, pressed && { opacity: 0.75 }]}
        >
          <View style={[styles.tickerIcon, { borderColor: alertAccent }]}>
            <MaterialIcons
              name={latestAlert ? "priority-high" : "radar"}
              size={14}
              color={alertAccent}
            />
          </View>
          <View style={styles.tickerBody}>
            <Text style={[styles.tickerMeta, { color: alertAccent }]}>
              {latestAlert
                ? `${formatRelative(latestAlert.timestamp)} · ${alertKindLabel(latestAlert.kind)}`
                : "VIGILANCIA ACTIVA"}
            </Text>
            <Text style={styles.tickerText} numberOfLines={1}>
              {latestAlert
                ? `${latestAlert.title}${
                    latestAlert.callsign ? ` · ${latestAlert.callsign}` : ""
                  }`
                : "Sin alertas registradas en esta sesión"}
            </Text>
          </View>
          <MaterialIcons
            name="chevron-right"
            size={18}
            color={RADAR.colors.muted}
          />
        </Pressable>

        {settings.showHazards && hazards.length > 0 ? (
          <View style={styles.hazardPanel}>
            <View style={styles.nearestHeader}>
              <Text style={styles.nearestTitle}>EVENTOS NASA · EONET</Text>
              <Pressable
                onPress={() => router.push("/nasa")}
                accessibilityRole="button"
                accessibilityLabel="Ver todos los eventos naturales NASA"
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={styles.nearestLink}>VER TODOS</Text>
              </Pressable>
            </View>
            {hazards.slice(0, 2).map((hazard, index) => (
              <View
                key={hazard.id}
                style={[
                  styles.nearestRow,
                  index > 0 && styles.nearestRowBorder,
                ]}
              >
                <MaterialIcons
                  name="local-fire-department"
                  size={16}
                  color={RADAR.colors.amber}
                />
                <View style={styles.nearestIdentity}>
                  <Text style={styles.nearestCallsign} numberOfLines={1}>
                    {hazard.categoryLabel}
                  </Text>
                  <Text style={styles.nearestMeta} numberOfLines={1}>
                    {hazard.title}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.nearestDistance,
                    {
                      color: hazard.isNear
                        ? RADAR.colors.amberSoft
                        : RADAR.colors.muted,
                    },
                  ]}
                >
                  {formatDistance(hazard.distanceM)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {visibleContacts.length > 0 ? (
          <View style={styles.nearestPanel}>
            <View style={styles.nearestHeader}>
              <Text style={styles.nearestTitle}>MÁS CERCANOS</Text>
              <Pressable
                onPress={() => router.push("/contacts")}
                accessibilityRole="button"
                accessibilityLabel="Ver todos los contactos"
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={styles.nearestLink}>VER TODOS</Text>
              </Pressable>
            </View>
            {visibleContacts.slice(0, 3).map((contact, index) => (
              <Pressable
                key={contact.id}
                onPress={() => selectContact(contact.id)}
                accessibilityRole="button"
                accessibilityLabel={`Seleccionar ${contact.callsign}`}
                style={({ pressed }) => [
                  styles.nearestRow,
                  index > 0 && styles.nearestRowBorder,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.nearestRank}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <View style={styles.nearestIdentity}>
                  <Text style={styles.nearestCallsign} numberOfLines={1}>
                    {contact.callsign}
                  </Text>
                  <Text style={styles.nearestMeta}>
                    {contact.uas ? "POSIBLE UAS" : "AERONAVE"} ·{" "}
                    {bearingToCompass(contact.bearingDeg)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.nearestDistance,
                    {
                      color: contact.isNear
                        ? RADAR.colors.red
                        : RADAR.colors.green,
                    },
                  ]}
                >
                  {formatDistance(contact.distanceM)}
                </Text>
                <MaterialIcons
                  name="chevron-right"
                  size={16}
                  color={RADAR.colors.mutedDark}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        {selectedContact ? (
          <ContactDetailCard
            contact={selectedContact}
            onClose={() => selectContact(null)}
          />
        ) : (
          <View style={styles.hintRow}>
            <Badge label="PISTA" tone="muted" />
            <Text style={styles.hintText}>
              Toca un blip del radar para inspeccionar latitud, longitud,
              distancia y estado.
            </Text>
          </View>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 11,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flexShrink: 1,
  },
  brandMark: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: RADAR.fonts.display,
    fontSize: 21,
    lineHeight: 23,
    letterSpacing: 1,
    color: RADAR.colors.text,
  },
  brandAccent: {
    color: RADAR.colors.cyan,
  },
  brandSub: {
    marginTop: 1,
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 1.1,
    color: RADAR.colors.muted,
  },
  feedGroup: {
    alignItems: "flex-end",
    gap: 4,
  },
  feedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: RADAR.colors.panel,
  },
  feedText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
  },
  clock: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.6,
    color: RADAR.colors.muted,
  },
  stationStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: RADAR.colors.border,
    paddingVertical: 7,
  },
  stationLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: RADAR.colors.cyanDim,
  },
  stationValue: {
    flex: 1,
    fontFamily: RADAR.fonts.mono,
    fontSize: 10,
    color: RADAR.colors.textDim,
  },
  stationUpdate: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.muted,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 6,
  },
  provenanceStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  provenanceText: {
    flex: 1,
    gap: 2,
  },
  provenanceTitle: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.7,
  },
  provenanceDetail: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.3,
    color: RADAR.colors.muted,
  },
  hiddenHint: {
    marginTop: -4,
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.muted,
    letterSpacing: 0.4,
  },
  radarPanel: {
    padding: 0,
    overflow: "hidden",
  },
  radarTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 4,
  },
  radarMeta: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: RADAR.colors.cyanDim,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderColor: RADAR.colors.border,
    marginTop: -4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  legendDiamond: {
    width: 6,
    height: 6,
    transform: [{ rotate: "45deg" }],
  },
  legendRing: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: RADAR.colors.red,
  },
  legendTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderBottomWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: RADAR.colors.amber,
  },
  legendText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.7,
    color: RADAR.colors.muted,
  },
  ticker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  tickerIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tickerBody: {
    flex: 1,
    gap: 1,
  },
  tickerMeta: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.9,
  },
  tickerText: {
    fontSize: 11,
    color: RADAR.colors.textDim,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  },
  hintText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    color: RADAR.colors.muted,
  },
  nearestPanel: {
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    paddingHorizontal: 10,
  },
  hazardPanel: {
    borderWidth: 1,
    borderColor: RADAR.colors.amberFaint,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    paddingHorizontal: 10,
  },
  nearestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 5,
  },
  nearestTitle: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1.2,
    color: RADAR.colors.cyanDim,
  },
  nearestLink: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.8,
    color: RADAR.colors.cyan,
  },
  nearestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
  },
  nearestRowBorder: {
    borderTopWidth: 1,
    borderColor: RADAR.colors.border,
  },
  nearestRank: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.mutedDark,
  },
  nearestIdentity: {
    flex: 1,
    gap: 1,
  },
  nearestCallsign: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 0.4,
    color: RADAR.colors.text,
  },
  nearestMeta: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.5,
    color: RADAR.colors.muted,
  },
  nearestDistance: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 13,
  },
});
