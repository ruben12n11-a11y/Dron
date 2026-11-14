import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Badge,
  Chip,
  GhostButton,
  HudPanel,
  Page,
  PageHeader,
  PrimaryButton,
  SectionTitle,
  StatusDot,
} from "@/components/hud";
import { RADAR } from "@/constants/radar-theme";
import { formatKp, kpSeverity, kpSeverityLabel } from "@/lib/nasa/parse";
import {
  bearingToCompass,
  formatBearing,
  formatDistance,
  formatRelative,
} from "@/lib/radar/geo";
import { readForegroundLocation } from "@/lib/radar/location";
import { useRadar } from "@/lib/radar/store";
import type { FeedStatus } from "@/lib/radar/types";

const RANGE_OPTIONS = [
  { value: 2000, label: "2 km" },
  { value: 5000, label: "5 km" },
  { value: 10_000, label: "10 km" },
  { value: 25_000, label: "25 km" },
  { value: 50_000, label: "50 km" },
  { value: 150_000, label: "150 km" },
];

const THRESHOLD_OPTIONS = [
  { value: 150, label: "150 m" },
  { value: 300, label: "300 m" },
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
];

const ALTITUDE_OPTIONS = [
  { value: 0, label: "0 ft" },
  { value: 100, label: "100 ft" },
  { value: 650, label: "650 ft" },
  { value: 1000, label: "1.000 ft" },
  { value: 3000, label: "3.000 ft" },
];

const SPEED_OPTIONS = [
  { value: 0, label: "0 kt" },
  { value: 10, label: "10 kt" },
  { value: 30, label: "30 kt" },
  { value: 60, label: "60 kt" },
];

const STATION_PRESETS = [
  { label: "San Francisco", lat: 37.7749, lon: -122.4194 },
  { label: "Madrid", lat: 40.4168, lon: -3.7038 },
  { label: "Ciudad de México", lat: 19.4326, lon: -99.1332 },
  { label: "Buenos Aires", lat: -34.6037, lon: -58.3816 },
];

function feedTone(status: FeedStatus): string {
  if (status === "live") return RADAR.colors.cyan;
  if (status === "error") return RADAR.colors.red;
  return RADAR.colors.cyanDim;
}

function feedLabel(status: FeedStatus): string {
  if (status === "live") return "ADS-B REAL";
  if (status === "error") return "SIN ENLACE";
  return "CONECTANDO";
}

function parseCoordinate(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: RADAR.colors.border,
          true: RADAR.colors.cyanDim,
        }}
        thumbColor={value ? RADAR.colors.cyan : RADAR.colors.muted}
        ios_backgroundColor={RADAR.colors.border}
        accessibilityLabel={label}
      />
    </View>
  );
}

function ResetConfirmModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={styles.confirmCard}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={styles.confirmTitle}>¿RESTABLECER AJUSTES?</Text>
          <Text style={styles.confirmText}>
            La estación volverá a San Francisco, con 5 km de alcance y 500 m de
            umbral. El registro de alertas se conserva.
          </Text>
          <View style={styles.confirmActions}>
            <View style={{ flex: 1 }}>
              <GhostButton label="CANCELAR" onPress={onCancel} tone="muted" />
            </View>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirmar restablecimiento"
              style={({ pressed }) => [
                styles.dangerButton,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text style={styles.dangerText}>RESTABLECER</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function SettingsScreen() {
  const {
    settings,
    feed,
    courseHeadingDeg,
    courseStatus,
    updateSettings,
    resetSettings,
    refresh,
    spaceWeather,
  } = useRadar();
  const [latDraft, setLatDraft] = useState<string | null>(null);
  const [lonDraft, setLonDraft] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [locationFeedback, setLocationFeedback] = useState<string | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [courseFeedback, setCourseFeedback] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const latInput = latDraft ?? settings.ownLat.toFixed(4);
  const lonInput = lonDraft ?? settings.ownLon.toFixed(4);

  const applyPosition = () => {
    setLocationFeedback(null);
    const lat = parseCoordinate(latInput);
    const lon = parseCoordinate(lonInput);
    if (lat === null || lat < -90 || lat > 90) {
      setPositionError("Latitud no válida. Debe estar entre -90 y 90.");
      return;
    }
    if (lon === null || lon < -180 || lon > 180) {
      setPositionError("Longitud no válida. Debe estar entre -180 y 180.");
      return;
    }
    setPositionError(null);
    updateSettings({ ownLat: lat, ownLon: lon });
    setLatDraft(null);
    setLonDraft(null);
  };

  const requestDeviceLocation = async () => {
    setLocationLoading(true);
    setLocationFeedback(null);
    setPositionError(null);
    try {
      const location = await readForegroundLocation({
        getPermission: () => Location.getForegroundPermissionsAsync(),
        requestPermission: () => Location.requestForegroundPermissionsAsync(),
        getPosition: async () => {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          return position.coords;
        },
      });

      if (location.status === "denied") {
        setPositionError(
          location.canAskAgain
            ? "Permiso de ubicación denegado. Puedes volver a intentarlo cuando quieras."
            : "Permiso bloqueado. Habilita la ubicación para Drone Radar en los ajustes del dispositivo y vuelve a intentarlo.",
        );
        return;
      }
      if (location.status === "invalid") {
        setPositionError(
          "El dispositivo devolvió coordenadas no válidas. Inténtalo de nuevo.",
        );
        return;
      }

      const { latitude, longitude, accuracy } = location;
      updateSettings({ ownLat: latitude, ownLon: longitude });
      setLatDraft(latitude.toFixed(5));
      setLonDraft(longitude.toFixed(5));
      setLocationFeedback(
        `Estación actualizada · precisión ${
          accuracy === null ? "no disponible" : `±${Math.round(accuracy)} m`
        }. No hay seguimiento en segundo plano.`,
      );
    } catch {
      setPositionError(
        "No se pudo obtener la ubicación. Comprueba que los servicios de ubicación estén activos y vuelve a intentarlo.",
      );
    } finally {
      setLocationLoading(false);
    }
  };

  const requestCourseUp = async () => {
    if (locationLoading) return;
    setLocationLoading(true);
    setCourseError(null);
    setCourseFeedback(null);
    try {
      const location = await readForegroundLocation({
        getPermission: () => Location.getForegroundPermissionsAsync(),
        requestPermission: () => Location.requestForegroundPermissionsAsync(),
        getPosition: async () => {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          return position.coords;
        },
      });

      if (location.status === "denied") {
        setCourseError(
          location.canAskAgain
            ? "Permiso denegado. Autoriza la ubicación foreground para usar Rumbo arriba."
            : "Permiso bloqueado. Habilita la ubicación para Drone Radar en Ajustes del dispositivo y reintenta.",
        );
        return;
      }
      if (location.status === "invalid") {
        setCourseError("No se obtuvo una posición GPS válida; Rumbo arriba no se activó.");
        return;
      }

      const { latitude, longitude, accuracy } = location;
      updateSettings({
        ownLat: latitude,
        ownLon: longitude,
        orientationMode: "course",
      });
      setLatDraft(latitude.toFixed(5));
      setLonDraft(longitude.toFixed(5));
      setCourseFeedback(
        `Rumbo arriba activo · precisión ${
          accuracy === null ? "no disponible" : `±${Math.round(accuracy)} m`
        }. GPS solo foreground.`,
      );
    } catch {
      setCourseError(
        "No se pudo activar Rumbo arriba. Comprueba los servicios de ubicación y vuelve a intentarlo.",
      );
    } finally {
      setLocationLoading(false);
    }
  };

  const tone = feedTone(feed.status);
  const parsedLat = parseCoordinate(latInput);
  const parsedLon = parseCoordinate(lonInput);
  const modeLabel =
    feed.status === "live"
      ? "ENLACE ACTIVO"
      : feed.status === "error"
        ? "SIN ENLACE"
        : "CONECTANDO";
  const orientationStatus =
    settings.orientationMode === "north"
      ? "NORTE GEOGRÁFICO ARRIBA · GPS de rumbo desactivado"
      : courseStatus === "active" && courseHeadingDeg !== null
        ? `RUMBO ${formatBearing(courseHeadingDeg)} ${bearingToCompass(courseHeadingDeg)} · APUNTA ARRIBA`
        : courseStatus === "paused"
          ? "GPS EN PAUSA · LA APP ESTÁ EN SEGUNDO PLANO"
          : courseStatus === "error"
            ? "GPS SIN SEÑAL · REINTENTA PARA AUTORIZAR O RECUPERAR EL CURSO"
            : "ESPERANDO MOVIMIENTO GPS FIABLE · MANTÉN LA APP ABIERTA";

  const kpIndex = spaceWeather?.maxKpIndex ?? null;
  const gnssRisk = spaceWeather?.gnssRisk === true;
  const spaceWeatherTitle = kpIndex === null ? "SIN DATOS DONKI" : formatKp(kpIndex);
  const spaceWeatherDetail =
    kpIndex === null
      ? "NASA DONKI no reporta actividad geomagnética reciente. El índice Kp mide la perturbación del campo magnético terrestre."
      : gnssRisk
        ? `Actividad geomagnética ${kpSeverityLabel(
            kpSeverity(kpIndex),
          )}. Puede degradar la precisión GPS del radar.`
        : "Actividad geomagnética baja. La precisión GPS del radar no se ve comprometida.";

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          eyebrow="DRONE RADAR // AJUSTES"
          title="Ajustes"
          subtitle="Configura estación, orientación y criterios de alerta. Solo datos ADS-B reales de OpenSky."
          right={<Badge label="v1.0.0" tone="muted" />}
        />

        <HudPanel style={styles.section}>
          <SectionTitle index="01" title="FUENTE ADS-B REAL" />
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <View style={styles.statusTitleRow}>
                <StatusDot color={tone} />
                <Text style={[styles.statusLabel, { color: tone }]}>
                  {feedLabel(feed.status)}
                </Text>
              </View>
              <Text style={styles.statusAge}>
                {feed.lastUpdate ? formatRelative(feed.lastUpdate) : "SIN DATOS"}
              </Text>
            </View>
            <Text style={styles.statusMessage}>{feed.message}</Text>
            <View style={styles.statusFooter}>
              <Text style={styles.statusMeta}>
                OPEN SKY NETWORK · {modeLabel}
              </Text>
              <GhostButton label="ACTUALIZAR" onPress={refresh} />
            </View>
          </View>
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="02" title="ESTACIÓN" />
          <Text style={styles.helperText}>
            Coordenadas de la estación que ocupa el centro del radar. Se usan
            para calcular distancia y rumbo de cada contacto.
          </Text>
          <Pressable
            onPress={() => void requestDeviceLocation()}
            disabled={locationLoading}
            accessibilityRole="button"
            accessibilityLabel="Usar mi ubicación actual para centrar la estación"
            accessibilityState={{ disabled: locationLoading }}
            style={({ pressed }) => [
              styles.locationButton,
              pressed && !locationLoading && { opacity: 0.72 },
            ]}
          >
            {locationLoading ? (
              <ActivityIndicator size="small" color={RADAR.colors.cyan} />
            ) : (
              <MaterialIcons
                name="my-location"
                size={16}
                color={RADAR.colors.cyan}
              />
            )}
            <Text style={styles.locationButtonText}>
              {locationLoading ? "LEYENDO UBICACIÓN…" : "USAR MI UBICACIÓN ACTUAL"}
            </Text>
          </Pressable>
          <Text style={styles.locationPrivacy}>
            Al pulsar se pedirá permiso en primer plano. La posición centra el
            radar y consulta el tráfico ADS-B cercano a OpenSky; no hay
            seguimiento en segundo plano.
          </Text>
          {locationFeedback ? (
            <Text style={styles.locationFeedback}>{locationFeedback}</Text>
          ) : null}
          <View style={styles.coordinateRow}>
            <View style={styles.coordinateField}>
              <Text style={styles.fieldLabel}>LATITUD</Text>
              <TextInput
                value={latInput}
                onChangeText={(value) => {
                  setLatDraft(value);
                  setLocationFeedback(null);
                }}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                placeholder="37.7749"
                placeholderTextColor={RADAR.colors.mutedDark}
                style={styles.input}
                accessibilityLabel="Latitud de la estación"
              />
            </View>
            <View style={styles.coordinateField}>
              <Text style={styles.fieldLabel}>LONGITUD</Text>
              <TextInput
                value={lonInput}
                onChangeText={(value) => {
                  setLonDraft(value);
                  setLocationFeedback(null);
                }}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                placeholder="-122.4194"
                placeholderTextColor={RADAR.colors.mutedDark}
                style={styles.input}
                accessibilityLabel="Longitud de la estación"
              />
            </View>
          </View>
          {positionError ? (
            <Text style={styles.errorText}>{positionError}</Text>
          ) : null}
          <View style={styles.presetRow}>
            {STATION_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label.toUpperCase()}
                active={
                  parsedLat !== null &&
                  parsedLon !== null &&
                  Math.abs(preset.lat - parsedLat) < 0.0001 &&
                  Math.abs(preset.lon - parsedLon) < 0.0001
                }
                onPress={() => {
                  setLocationFeedback(null);
                  setLatDraft(preset.lat.toFixed(4));
                  setLonDraft(preset.lon.toFixed(4));
                  setPositionError(null);
                }}
              />
            ))}
          </View>
          <PrimaryButton label="APLICAR POSICIÓN" onPress={applyPosition} />
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="03" title="ORIENTACIÓN DEL RADAR" />
          <Text style={styles.helperText}>
            Elige si la pantalla conserva el norte arriba o gira para poner tu
            dirección de marcha arriba.
          </Text>
          <View style={styles.chipRow}>
            <Chip
              label="NORTE ARRIBA"
              active={settings.orientationMode === "north"}
              onPress={() => {
                if (locationLoading) return;
                setCourseError(null);
                setCourseFeedback(null);
                updateSettings({ orientationMode: "north" });
              }}
            />
            <Chip
              label={locationLoading ? "LEYENDO GPS…" : "RUMBO ARRIBA"}
              active={settings.orientationMode === "course"}
              onPress={() => void requestCourseUp()}
            />
          </View>
          <Text
            style={[
              styles.orientationStatus,
              courseStatus === "active" && { color: RADAR.colors.green },
              courseStatus === "error" && { color: RADAR.colors.red },
            ]}
          >
            {orientationStatus}
          </Text>
          {courseError ? (
            <Text style={styles.errorText}>{courseError}</Text>
          ) : null}
          {courseFeedback ? (
            <Text style={styles.locationFeedback}>{courseFeedback}</Text>
          ) : null}
          <Text style={styles.locationPrivacy}>
            Rumbo arriba solicita ubicación foreground al activarse, sigue el
            desplazamiento solo con la app abierta y pausa el GPS al ir al fondo.
            Sin permiso ni seguimiento en segundo plano. Al caminar al sur, S
            queda arriba y N abajo.
          </Text>
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="04" title="ALCANCE Y UMBRAL" />
          <Text style={styles.fieldLabel}>ALCANCE VISUAL DEL RADAR</Text>
          <View style={styles.chipRow}>
            {RANGE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={settings.rangeM === option.value}
                onPress={() => updateSettings({ rangeM: option.value })}
              />
            ))}
          </View>
          <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
            UMBRAL DE PROXIMIDAD · {formatDistance(settings.thresholdM)}
          </Text>
          <View style={styles.chipRow}>
            {THRESHOLD_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={settings.thresholdM === option.value}
                onPress={() => updateSettings({ thresholdM: option.value })}
                tone="red"
              />
            ))}
          </View>
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="05" title="FILTROS" />
          <Text style={styles.helperText}>
            Los contactos por debajo de estos mínimos se ocultan del radar y de
            la lista, y no generan alertas.
          </Text>
          <Text style={styles.fieldLabel}>ALTITUD MÍNIMA</Text>
          <View style={styles.chipRow}>
            {ALTITUDE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={settings.minAltFt === option.value}
                onPress={() => updateSettings({ minAltFt: option.value })}
              />
            ))}
          </View>
          <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
            VELOCIDAD MÍNIMA
          </Text>
          <View style={styles.chipRow}>
            {SPEED_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={settings.minSpeedKt === option.value}
                onPress={() => updateSettings({ minSpeedKt: option.value })}
              />
            ))}
          </View>
          <Text style={styles.filterNote}>
            0 kt muestra también drones estáticos. La detección de reversión
            exige ≥ 30 kt, igual que el detector original.
          </Text>
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="06" title="ALERTAS" />
          <ToggleRow
            label="Proximidad"
            description="Avisa cuando un contacto entra en el umbral."
            value={settings.proximityAlerts}
            onValueChange={(value) => updateSettings({ proximityAlerts: value })}
          />
          <View style={styles.toggleDivider} />
          <ToggleRow
            label="Reversión de trayectoria"
            description="Giro superior a 150° con velocidad ≥ 30 kt."
            value={settings.turnAlerts}
            onValueChange={(value) => updateSettings({ turnAlerts: value })}
          />
          <View style={styles.toggleDivider} />
          <ToggleRow
            label="Posibles UAS"
            description="Indicios por callsign, ICAO o categoría ADS-B."
            value={settings.uasAlerts}
            onValueChange={(value) => updateSettings({ uasAlerts: value })}
          />
          <View style={styles.toggleDivider} />
          <ToggleRow
            label="Eventos naturales NASA"
            description="Avisa cuando un incendio, tormenta o volcán entra en el umbral."
            value={settings.hazardAlerts}
            onValueChange={(value) => updateSettings({ hazardAlerts: value })}
          />
          <View style={styles.toggleDivider} />
          <ToggleRow
            label="Vibración"
            description="Pulso háptico al recibir una alerta crítica."
            value={settings.haptics}
            onValueChange={(value) => updateSettings({ haptics: value })}
          />
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="07" title="NASA · EVENTOS Y CLIMA ESPACIAL" />
          <ToggleRow
            label="Capa de eventos naturales"
            description="Superpone en el radar los eventos geolocalizados de NASA EONET (incendios, tormentas, volcanes)."
            value={settings.showHazards}
            onValueChange={(value) => updateSettings({ showHazards: value })}
          />
          <View style={styles.toggleDivider} />
          <View style={styles.systemRow}>
            <View style={styles.systemText}>
              <Text style={styles.systemTitle}>{spaceWeatherTitle}</Text>
              <Text style={styles.systemDescription}>{spaceWeatherDetail}</Text>
            </View>
            <MaterialIcons
              name="public"
              size={30}
              color={gnssRisk ? RADAR.colors.amber : RADAR.colors.mutedDark}
            />
          </View>
          <Text style={styles.nasaAttribution}>
            Eventos: NASA EONET · Clima espacial: NASA DONKI. Datos de dominio
            público.
          </Text>
        </HudPanel>

        <HudPanel style={styles.section}>
          <SectionTitle index="08" title="SISTEMA" />
          <View style={styles.systemRow}>
            <View style={styles.systemText}>
              <Text style={styles.systemTitle}>DRONE RADAR MÓVIL</Text>
              <Text style={styles.systemDescription}>
                Radar táctico ADS-B basado en el servidor y los detectores del
                proyecto original. OpenSky anónimo tiene cuota limitada y se
                consulta cada 60 s; para sesiones largas usa credenciales
                OAuth. Los datos pueden estar incompletos; no usar para
                navegación ni seguridad aérea.
              </Text>
            </View>
            <MaterialIcons
              name="radar"
              size={30}
              color={RADAR.colors.mutedDark}
            />
          </View>
          <GhostButton
            label="RESTABLECER CONFIGURACIÓN"
            onPress={() => setResetVisible(true)}
            tone="red"
          />
        </HudPanel>
      </ScrollView>

      <ResetConfirmModal
        visible={resetVisible}
        onCancel={() => setResetVisible(false)}
        onConfirm={() => {
          resetSettings();
          setLatDraft(null);
          setLonDraft(null);
          setPositionError(null);
          setLocationFeedback(null);
          setCourseError(null);
          setCourseFeedback(null);
          setResetVisible(false);
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 28,
    gap: 11,
  },
  section: {
    gap: 8,
  },
  nasaAttribution: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.6,
    lineHeight: 11,
    color: RADAR.colors.mutedDark,
  },
  statusCard: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panelSoft,
    padding: 10,
    gap: 5,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
  },
  statusAge: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.muted,
  },
  statusMessage: {
    fontSize: 10,
    lineHeight: 14,
    color: RADAR.colors.textDim,
  },
  statusFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
  },
  statusMeta: {
    flex: 1,
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.muted,
  },
  helperText: {
    fontSize: 10,
    lineHeight: 15,
    color: RADAR.colors.muted,
  },
  coordinateRow: {
    flexDirection: "row",
    gap: 8,
  },
  locationButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: RADAR.colors.cyanDim,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.cyanFaint,
    paddingHorizontal: 10,
  },
  locationButtonText: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 10,
    letterSpacing: 0.8,
    color: RADAR.colors.cyan,
  },
  locationPrivacy: {
    fontSize: 9,
    lineHeight: 13,
    color: RADAR.colors.muted,
  },
  locationFeedback: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    lineHeight: 13,
    color: RADAR.colors.cyanDim,
  },
  orientationStatus: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    lineHeight: 13,
    color: RADAR.colors.cyan,
  },
  coordinateField: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.9,
    color: RADAR.colors.cyanDim,
  },
  input: {
    height: 38,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: 5,
    backgroundColor: RADAR.colors.panelSoft,
    paddingHorizontal: 9,
    fontFamily: RADAR.fonts.mono,
    fontSize: 13,
    color: RADAR.colors.text,
  },
  errorText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    lineHeight: 13,
    color: RADAR.colors.red,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  filterNote: {
    marginTop: 3,
    fontSize: 9,
    lineHeight: 13,
    color: RADAR.colors.muted,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  toggleText: {
    flex: 1,
    gap: 1,
  },
  toggleLabel: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 0.6,
    color: RADAR.colors.text,
  },
  toggleDescription: {
    fontSize: 9,
    lineHeight: 13,
    color: RADAR.colors.muted,
  },
  toggleDivider: {
    height: 1,
    backgroundColor: RADAR.colors.border,
  },
  systemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  systemText: {
    flex: 1,
    gap: 3,
  },
  systemTitle: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 1,
    color: RADAR.colors.textDim,
  },
  systemDescription: {
    fontSize: 9,
    lineHeight: 14,
    color: RADAR.colors.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 4, 6, 0.84)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: RADAR.colors.borderStrong,
    borderRadius: RADAR.radius.lg,
    backgroundColor: RADAR.colors.panelRaised,
    padding: 18,
    gap: 8,
  },
  confirmTitle: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 16,
    letterSpacing: 1,
    color: RADAR.colors.text,
  },
  confirmText: {
    fontSize: 11,
    lineHeight: 17,
    color: RADAR.colors.textDim,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  dangerButton: {
    flex: 1,
    height: 36,
    borderRadius: 5,
    backgroundColor: RADAR.colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: RADAR.colors.bgDeep,
  },
});
