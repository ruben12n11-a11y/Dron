import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Badge,
  Chip,
  HudPanel,
  Page,
  PageHeader,
  SectionTitle,
  StatusDot,
} from "@/components/hud";
import { RADAR } from "@/constants/radar-theme";
import { kpSeverity, kpSeverityLabel } from "@/lib/nasa/parse";
import type { HazardView } from "@/lib/nasa/hazard-view";
import {
  bearingToCompass,
  formatClockUtc,
  formatDistance,
  formatRelative,
} from "@/lib/radar/geo";
import { useRadar } from "@/lib/radar/store";

function severityTone(kp: number): "cyan" | "amber" | "red" {
  const severity = kpSeverity(kp);
  if (severity === "critical") return "red";
  if (severity === "warning") return "amber";
  return "cyan";
}

function HazardRow({ hazard }: { hazard: HazardView }) {
  const openLink = () => {
    if (hazard.link) void Linking.openURL(hazard.link);
  };

  const magnitude =
    hazard.magnitudeValue !== null
      ? `${hazard.magnitudeValue.toLocaleString("es-ES")} ${
          hazard.magnitudeUnit ?? ""
        }`.trim()
      : null;

  return (
    <Pressable
      onPress={openLink}
      disabled={!hazard.link}
      accessibilityRole={hazard.link ? "link" : "text"}
      accessibilityLabel={`${hazard.categoryLabel}: ${hazard.title}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View
        style={[
          styles.rowIcon,
          hazard.isNear && { borderColor: RADAR.colors.amber },
        ]}
      >
        <MaterialIcons
          name="local-fire-department"
          size={15}
          color={hazard.isNear ? RADAR.colors.amberSoft : RADAR.colors.amber}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {hazard.categoryLabel}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {hazard.title}
        </Text>
        <Text style={styles.rowMeta}>
          {bearingToCompass(hazard.bearingDeg)} ·{" "}
          {formatRelative(hazard.observedAt)}
          {magnitude ? ` · ${magnitude}` : ""}
        </Text>
      </View>
      <View style={styles.rowDistance}>
        <Text
          style={[
            styles.rowDistanceValue,
            {
              color: hazard.isNear
                ? RADAR.colors.amberSoft
                : RADAR.colors.text,
            },
          ]}
        >
          {formatDistance(hazard.distanceM)}
        </Text>
        {hazard.link ? (
          <MaterialIcons
            name="open-in-new"
            size={13}
            color={RADAR.colors.mutedDark}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export default function NasaScreen() {
  const { hazards, spaceWeather, hazardsError, settings, refresh } = useRadar();

  const visibleHazards = useMemo(
    () => hazards.filter((hazard) => hazard.isVisible),
    [hazards],
  );

  const kpIndex = spaceWeather?.maxKpIndex ?? null;
  const gnssRisk = spaceWeather?.gnssRisk === true;
  const accentColor =
    kpIndex === null
      ? RADAR.colors.cyanDim
      : severityTone(kpIndex) === "red"
        ? RADAR.colors.red
        : severityTone(kpIndex) === "amber"
          ? RADAR.colors.amber
          : RADAR.colors.cyan;

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <PageHeader
          eyebrow="DRONE RADAR // NASA"
          title="NASA"
          subtitle="Eventos naturales geolocalizados (EONET) y clima espacial (DONKI)."
          right={
            hazards.length > 0 ? (
              <Badge label={`${visibleHazards.length} EN ALCANCE`} tone="amber" />
            ) : (
              <Badge label="SIN EVENTOS" tone="muted" />
            )
          }
        />

        <HudPanel style={styles.section}>
          <SectionTitle index="01" title="CLIMA ESPACIAL · DONKI" />
          <View style={styles.weatherRow}>
            <View
              style={[
                styles.weatherDial,
                {
                  borderColor: accentColor,
                },
              ]}
            >
              <Text style={styles.weatherKp}>
                {kpIndex === null ? "—" : kpIndex.toFixed(1)}
              </Text>
              <Text style={styles.weatherKpLabel}>KP</Text>
            </View>
            <View style={styles.weatherBody}>
              <View style={styles.weatherStatus}>
                <StatusDot
                  color={
                    gnssRisk ? RADAR.colors.amber : RADAR.colors.cyan
                  }
                />
                <Text
                  style={[
                    styles.weatherStatusText,
                    {
                      color: gnssRisk
                        ? RADAR.colors.amberSoft
                        : RADAR.colors.cyan,
                    },
                  ]}
                >
                  {kpIndex === null
                    ? "SIN DATOS"
                    : gnssRisk
                      ? "GNSS DEGRADADO"
                      : "GNSS NOMINAL"}
                </Text>
              </View>
              <Text style={styles.weatherDescription}>
                {kpIndex === null
                  ? "NASA DONKI no reporta actividad geomagnética reciente."
                  : gnssRisk
                    ? `Actividad ${kpSeverityLabel(
                        kpSeverity(kpIndex),
                      )}: la ionosfera puede degradar la precisión GPS del radar.`
                    : "Actividad baja: la precisión GPS del radar no se ve comprometida."}
              </Text>
              {spaceWeather?.observedAt ? (
                <Text style={styles.weatherMeta}>
                  Último Kp · {formatClockUtc(spaceWeather.observedAt)} UTC
                </Text>
              ) : null}
            </View>
          </View>
          {spaceWeather && spaceWeather.samples.length > 1 ? (
            <View style={styles.sparkRow}>
              {spaceWeather.samples.slice(-24).map((sample) => {
                const height = 4 + Math.min(1, sample.kpIndex / 9) * 22;
                return (
                  <View
                    key={sample.observedAt}
                    style={[
                      styles.sparkBar,
                      {
                        height,
                        backgroundColor: gnssRisk
                          ? RADAR.colors.amber
                          : RADAR.colors.cyanDim,
                      },
                    ]}
                  />
                );
              })}
            </View>
          ) : null}
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle
            index="02"
            title="EVENTOS NATURALES · EONET"
            right={<Chip label="ACTUALIZAR" onPress={refresh} />}
          />
          {visibleHazards.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons
                name="public"
                size={34}
                color={RADAR.colors.mutedDark}
              />
              <Text style={styles.emptyText}>
                {hazardsError
                  ? `No se pudo consultar NASA EONET: ${hazardsError}`
                  : `Sin eventos naturales en un radio de ${formatDistance(
                      settings.rangeM,
                    )} alrededor de la estación.`}
              </Text>
            </View>
          ) : (
            visibleHazards.map((hazard, index) => (
              <View
                key={hazard.id}
                style={index > 0 ? styles.rowDivider : undefined}
              >
                <HazardRow hazard={hazard} />
              </View>
            ))
          )}
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="03" title="FUENTES" />
          <Text style={styles.sourcesText}>
            Eventos naturales: NASA EONET v3 (dominio público, sin clave).
            Clima espacial: NASA DONKI (requiere NASA_API_KEY en el servidor).
            Los eventos se filtran por el rectángulo del radar y se ordenan por
            distancia. Los datos pueden estar incompletos; no usar para
            navegación ni seguridad aérea.
          </Text>
        </HudPanel>
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
  section: {
    gap: 8,
  },
  weatherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  weatherDial: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  weatherKp: {
    fontFamily: RADAR.fonts.display,
    fontSize: 22,
    lineHeight: 24,
    color: RADAR.colors.text,
  },
  weatherKpLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 1.4,
    color: RADAR.colors.muted,
  },
  weatherBody: {
    flex: 1,
    gap: 3,
  },
  weatherStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  weatherStatusText: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  weatherDescription: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    lineHeight: 12,
    color: RADAR.colors.muted,
  },
  weatherMeta: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.5,
    color: RADAR.colors.mutedDark,
  },
  sparkRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    height: 28,
  },
  sparkBar: {
    flex: 1,
    borderRadius: 1,
    minWidth: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderColor: RADAR.colors.border,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: RADAR.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  rowTitle: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 0.4,
    color: RADAR.colors.text,
  },
  rowMeta: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.4,
    color: RADAR.colors.muted,
  },
  rowDistance: {
    alignItems: "flex-end",
    gap: 3,
  },
  rowDistanceValue: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 13,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  emptyText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    lineHeight: 12,
    textAlign: "center",
    color: RADAR.colors.muted,
  },
  sourcesText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    lineHeight: 13,
    color: RADAR.colors.muted,
  },
});
