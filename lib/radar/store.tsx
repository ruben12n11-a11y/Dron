import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";

import { fetchHazards, fetchSpaceWeather } from "@/lib/nasa/fetch";
import { viewHazard, type HazardView } from "@/lib/nasa/hazard-view";
import { kpSeverity } from "@/lib/nasa/parse";
import type { HazardEvent, SpaceWeather } from "@/lib/nasa/types";

import {
  createGnssAlert,
  createHazardAlert,
  createProximityAlert,
  createSystemAlert,
  createTurnAlert,
  createUasAlert,
} from "./alerts";
import { enrichContact } from "./enrich";
import { clamp, formatClockUtc, formatRelative, haversineM } from "./geo";
import {
  COURSE_MAX_SAMPLE_GAP_MS,
  COURSE_STALE_AFTER_MS,
  estimateCourse,
  smoothCourse,
  type CourseSample,
} from "./course";
import { fetchOpenSkyContacts } from "./opensky";
import type {
  AlertSeverity,
  CourseTrackingStatus,
  EnrichedContact,
  FeedState,
  FeedStatus,
  PositionSample,
  RadarAlert,
  RadarContact,
  RadarMetrics,
  RadarSettings,
  RuntimeMode,
} from "./types";

const SETTINGS_KEY = "drone-radar.settings.v1";
const ALERTS_KEY = "drone-radar.alerts.v1";
const MAX_ALERTS = 120;

export const DEFAULT_SETTINGS: RadarSettings = {
  ownLat: 37.7749,
  ownLon: -122.4194,
  thresholdM: 500,
  rangeM: 5000,
  minAltFt: 0,
  minSpeedKt: 0,
  orientationMode: "north",
  haptics: true,
  proximityAlerts: true,
  turnAlerts: true,
  uasAlerts: true,
  showHazards: true,
  hazardAlerts: true,
};

function safeNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

export function sanitizeSettings(value: Partial<RadarSettings>): RadarSettings {
  const merged = { ...DEFAULT_SETTINGS, ...value };
  return {
    ownLat: safeNumber(merged.ownLat, -90, 90, DEFAULT_SETTINGS.ownLat),
    ownLon: safeNumber(merged.ownLon, -180, 180, DEFAULT_SETTINGS.ownLon),
    thresholdM: safeNumber(
      merged.thresholdM,
      50,
      50_000,
      DEFAULT_SETTINGS.thresholdM,
    ),
    rangeM: safeNumber(merged.rangeM, 500, 250_000, DEFAULT_SETTINGS.rangeM),
    minAltFt: safeNumber(merged.minAltFt, 0, 60_000, 0),
    minSpeedKt: safeNumber(merged.minSpeedKt, 0, 1000, 0),
    orientationMode:
      merged.orientationMode === "course" ? "course" : "north",
    haptics: Boolean(merged.haptics),
    proximityAlerts: Boolean(merged.proximityAlerts),
    turnAlerts: Boolean(merged.turnAlerts),
    uasAlerts: Boolean(merged.uasAlerts),
    // `merged` already inherits the defaults, so legacy payloads keep hazards on.
    showHazards: Boolean(merged.showHazards),
    hazardAlerts: Boolean(merged.hazardAlerts),
  };
}

function isValidAlert(value: unknown): value is RadarAlert {
  if (!value || typeof value !== "object") return false;
  const alert = value as Partial<RadarAlert>;
  return (
    typeof alert.id === "string" &&
    typeof alert.title === "string" &&
    typeof alert.message === "string" &&
    typeof alert.timestamp === "number" &&
    (alert.kind === "proximity" ||
      alert.kind === "turn" ||
      alert.kind === "uas" ||
      alert.kind === "hazard" ||
      alert.kind === "system")
  );
}

function isLegacySyntheticAlert(alert: RadarAlert): boolean {
  const text = `${alert.title} ${alert.message}`.toLocaleLowerCase("es");
  return (
    alert.contactId?.startsWith("sim:") === true ||
    /simulad|respaldo simulado/.test(text)
  );
}

interface RadarContextValue {
  settings: RadarSettings;
  contacts: EnrichedContact[];
  visibleContacts: EnrichedContact[];
  alerts: RadarAlert[];
  feed: FeedState;
  courseHeadingDeg: number | null;
  courseStatus: CourseTrackingStatus;
  metrics: RadarMetrics;
  selectedId: string | null;
  selectedContact: EnrichedContact | null;
  isHydrated: boolean;
  /** NASA EONET natural hazards near the station, sorted by distance. */
  hazards: HazardView[];
  /** Latest NASA DONKI space-weather snapshot, or null before the first fetch. */
  spaceWeather: SpaceWeather | null;
  /** Whether the last hazards request failed; the overlay keeps the last good data. */
  hazardsError: string | null;
  updateSettings: (patch: Partial<RadarSettings>) => void;
  resetSettings: () => void;
  selectContact: (id: string | null) => void;
  clearAlerts: () => void;
  refresh: () => void;
}

const RadarContext = createContext<RadarContextValue | null>(null);

export function RadarProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<RadarSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [contacts, setContacts] = useState<RadarContact[]>([]);
  const [alerts, setAlerts] = useState<RadarAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("connecting");
  const runtimeModeRef = useRef<RuntimeMode>("connecting");
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("connecting");
  const [feedMessage, setFeedMessage] = useState(
    "Estableciendo enlace con OpenSky…",
  );
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [courseHeadingDeg, setCourseHeadingDeg] = useState<number | null>(null);
  const [courseStatus, setCourseStatus] = useState<CourseTrackingStatus>("off");
  const [courseRetryKey, setCourseRetryKey] = useState(0);
  const [appIsActive, setAppIsActive] = useState(
    () => AppState.currentState !== "background" && AppState.currentState !== "inactive",
  );
  const [rawHazards, setRawHazards] = useState<HazardEvent[]>([]);
  const [spaceWeather, setSpaceWeather] = useState<SpaceWeather | null>(null);
  const [hazardsError, setHazardsError] = useState<string | null>(null);

  const historyRef = useRef(new Map<string, PositionSample[]>());
  const prevNearRef = useRef(new Map<string, boolean>());
  const cooldownRef = useRef(new Map<string, number>());
  const uasSeenRef = useRef(new Set<string>());
  const hazardNearRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppIsActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    runtimeModeRef.current = runtimeMode;
  }, [runtimeMode]);

  const pushAlerts = useCallback((items: RadarAlert[]) => {
    if (items.length === 0) return;
    setAlerts((previous) => [...items, ...previous].slice(0, MAX_ALERTS));
    const hasCritical = items.some((item) => item.severity === "critical");
    if (
      hasCritical &&
      settingsRef.current.haptics &&
      Platform.OS !== "web"
    ) {
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
    }
  }, []);

  const addSystemAlert = useCallback(
    (title: string, message: string, severity: AlertSeverity = "info") => {
      pushAlerts([createSystemAlert(title, message, severity)]);
    },
    [pushAlerts],
  );

  const canAlert = useCallback(
    (key: string, cooldownMs: number, now: number): boolean => {
      const previous = cooldownRef.current.get(key) ?? 0;
      if (now - previous < cooldownMs) return false;
      cooldownRef.current.set(key, now);
      return true;
    },
    [],
  );

  const ingestContacts = useCallback(
    (nextContacts: RadarContact[], observedAt: number) => {
      const now = Date.now();
      const current = settingsRef.current;
      const presentIds = new Set(nextContacts.map((contact) => contact.id));

      // Drop tracks that disappeared so a reappearing contact starts clean
      // instead of producing a false reversal or missing a proximity alert.
      for (const id of historyRef.current.keys()) {
        if (!presentIds.has(id)) historyRef.current.delete(id);
      }
      for (const id of prevNearRef.current.keys()) {
        if (!presentIds.has(id)) prevNearRef.current.delete(id);
      }

      for (const contact of nextContacts) {
        const samples = historyRef.current.get(contact.id) ?? [];
        const lastSample = samples[samples.length - 1];
        if (
          !lastSample ||
          now - lastSample.t >= 500 ||
          lastSample.lat !== contact.lat ||
          lastSample.lon !== contact.lon
        ) {
          samples.push({ t: now, lat: contact.lat, lon: contact.lon });
          if (samples.length > 8) samples.splice(0, samples.length - 8);
          historyRef.current.set(contact.id, samples);
        }
      }

      const enriched = nextContacts.map((contact) =>
        enrichContact(
          contact,
          current,
          historyRef.current.get(contact.id) ?? [],
        ),
      );

      const newAlerts: RadarAlert[] = [];
      for (const contact of enriched) {
        const wasNear = prevNearRef.current.get(contact.id) === true;
        prevNearRef.current.set(contact.id, contact.isNear);
        if (!contact.isVisible) continue;

        if (
          current.proximityAlerts &&
          contact.isNear &&
          !wasNear &&
          canAlert(`prox:${contact.id}`, 60_000, now)
        ) {
          newAlerts.push(
            createProximityAlert(contact, current.thresholdM, now),
          );
        }

        if (
          current.uasAlerts &&
          contact.uas &&
          !uasSeenRef.current.has(contact.id) &&
          canAlert(`uas:${contact.id}`, 600_000, now)
        ) {
          uasSeenRef.current.add(contact.id);
          newAlerts.push(createUasAlert(contact, now));
        }

        if (
          current.turnAlerts &&
          contact.turnDeg > 150 &&
          contact.speedKt >= 30 &&
          canAlert(`turn:${contact.id}`, 120_000, now)
        ) {
          newAlerts.push(createTurnAlert(contact, now));
        }
      }

      setContacts(nextContacts);
      setLastUpdate(observedAt);
      setFeedStatus("live");
      pushAlerts(newAlerts);
    },
    [canAlert, pushAlerts],
  );

  // Restore persisted settings and alert history.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [settingsRaw, alertsRaw] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(ALERTS_KEY),
        ]);
        if (!alive) return;
        if (settingsRaw) {
          try {
            setSettings(
              sanitizeSettings(JSON.parse(settingsRaw) as Partial<RadarSettings>),
            );
          } catch {
            // Keep defaults when the stored payload is corrupt.
          }
        }
        if (alertsRaw) {
          try {
            const parsed = JSON.parse(alertsRaw) as unknown;
            if (Array.isArray(parsed)) {
              setAlerts(
                parsed
                  .filter(isValidAlert)
                  .filter((alert) => !isLegacySyntheticAlert(alert))
                  .slice(0, MAX_ALERTS),
              );
            }
          } catch {
            // Keep an empty log when the stored payload is corrupt.
          }
        }
      } finally {
        if (alive) setIsHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(
      () => undefined,
    );
  }, [settings, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(alerts)).catch(
      () => undefined,
    );
  }, [alerts, isHydrated]);

  // OpenSky is the only contact source. Empty snapshots stay empty; errors
  // clear contacts and surface the upstream/client message without fabrication.
  useEffect(() => {
    if (!isHydrated) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const request = async () => {
      if (cancelled) return;
      if (runtimeModeRef.current !== "live") {
        setFeedStatus("connecting");
        setFeedMessage("Estableciendo enlace con OpenSky…");
      }

      try {
        const result = await fetchOpenSkyContacts({
          lat: settings.ownLat,
          lon: settings.ownLon,
          radiusKm: clamp(Math.round(settings.rangeM / 1000), 5, 250),
        });
        if (cancelled) return;

        setRuntimeMode("live");
        setFeedStatus("live");
        const contactSummary =
          result.contacts.length === 0
            ? "0 contactos en este alcance"
            : `${result.contacts.length} contacto${result.contacts.length === 1 ? "" : "s"}`;
        setFeedMessage(
          `OpenSky Network · ${contactSummary} · muestra UTC ${formatClockUtc(result.sourceTimestamp)} (${formatRelative(result.sourceTimestamp)})`,
        );
        ingestContacts(result.contacts, result.sourceTimestamp);
        // 60 s keeps anonymous OpenSky quota usable for longer sessions.
        timer = setTimeout(request, 60_000);
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "No se pudo consultar OpenSky.";

        setRuntimeMode("live");
        setFeedStatus("error");
        setFeedMessage(message);
        setContacts([]);
        setSelectedId(null);
        setLastUpdate(null);
        historyRef.current.clear();
        prevNearRef.current.clear();
        if (canAlert("system:opensky-error", 300_000, Date.now())) {
          addSystemAlert(
            "Enlace OpenSky interrumpido",
            `${message} No se mostrarán contactos hasta recibir una muestra ADS-B válida.`,
            "warning",
          );
        }
        timer = setTimeout(request, 60_000);
      }
    };

    void request();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    isHydrated,
    settings.ownLat,
    settings.ownLon,
    settings.rangeM,
    refreshKey,
    ingestContacts,
    addSystemAlert,
    canAlert,
  ]);

  // NASA EONET natural hazards near the station. These are independent of the
  // ADS-B feed: a NASA outage never clears contacts, and an OpenSky outage
  // never clears hazards. The last good snapshot stays on screen while a
  // retry is pending.
  useEffect(() => {
    if (!isHydrated) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const request = async () => {
      if (cancelled) return;
      try {
        const result = await fetchHazards({
          lat: settings.ownLat,
          lon: settings.ownLon,
          radiusKm: clamp(Math.round(settings.rangeM / 1000), 5, 500),
        });
        if (cancelled) return;
        const current = settingsRef.current;
        const views = result.hazards
          .map((hazard) =>
            viewHazard(
              hazard,
              current.ownLat,
              current.ownLon,
              current.rangeM,
              current.thresholdM,
            ),
          )
          .sort((a, b) => a.distanceM - b.distanceM);

        setRawHazards(result.hazards);
        setHazardsError(null);

        if (current.hazardAlerts) {
          const now = Date.now();
          const newAlerts: RadarAlert[] = [];
          const present = new Set(views.map((view) => view.id));
          for (const id of hazardNearRef.current.keys()) {
            if (!present.has(id)) hazardNearRef.current.delete(id);
          }
          for (const view of views) {
            const wasNear = hazardNearRef.current.get(view.id) === true;
            hazardNearRef.current.set(view.id, view.isNear);
            if (!view.isVisible || !view.isNear || wasNear) continue;
            if (canAlert(`hazard:${view.id}`, 30 * 60_000, now)) {
              newAlerts.push(createHazardAlert(view, current.thresholdM, now));
            }
          }
          pushAlerts(newAlerts);
        }

        // Hazards change slowly; 10 min keeps the shared EONET feed polite.
        timer = setTimeout(request, 10 * 60_000);
      } catch (error) {
        if (cancelled) return;
        setHazardsError(
          error instanceof Error ? error.message : "No se pudo consultar EONET.",
        );
        timer = setTimeout(request, 10 * 60_000);
      }
    };

    void request();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    isHydrated,
    settings.ownLat,
    settings.ownLon,
    settings.rangeM,
    refreshKey,
    canAlert,
    pushAlerts,
  ]);

  // NASA DONKI space weather. A high geomagnetic Kp index can degrade the GNSS
  // fixes the radar relies on, so it is surfaced as a system advisory.
  useEffect(() => {
    if (!isHydrated) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const request = async () => {
      if (cancelled) return;
      try {
        const result = await fetchSpaceWeather();
        if (cancelled) return;
        setSpaceWeather(result.weather);
        const { maxKpIndex, observedAt, gnssRisk } = result.weather;
        if (gnssRisk && maxKpIndex !== null && observedAt !== null) {
          const now = Date.now();
          if (canAlert("system:gnss-kp", 6 * 60 * 60_000, now)) {
            addSystemAlert(
              "Clima espacial: GNSS degradado",
              `NASA DONKI reporta Kp ${maxKpIndex.toFixed(
                1,
              )} (${formatClockUtc(observedAt)} UTC). La actividad geomagnética puede degradar la precisión GPS del radar.`,
              kpSeverity(maxKpIndex),
            );
          }
        }
        timer = setTimeout(request, 30 * 60_000);
      } catch {
        if (cancelled) return;
        // Space weather is advisory only; a failure leaves the last value in
        // place and silently retries rather than spamming the alert log.
        timer = setTimeout(request, 30 * 60_000);
      }
    };

    void request();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isHydrated, refreshKey, canAlert, addSystemAlert]);

  const updateSettings = useCallback((patch: Partial<RadarSettings>) => {
    const previous = settingsRef.current;
    const next = sanitizeSettings({ ...previous, ...patch });
    settingsRef.current = next;

    const coordinatesChanged =
      next.ownLat !== previous.ownLat || next.ownLon !== previous.ownLon;
    const scopeChanged = coordinatesChanged || next.rangeM !== previous.rangeM;

    if (scopeChanged) {
      historyRef.current.clear();
      prevNearRef.current.clear();
      cooldownRef.current.clear();
      uasSeenRef.current.clear();
      setSelectedId(null);
    }

    if (scopeChanged) {
      setContacts([]);
      setLastUpdate(null);
      setFeedStatus("connecting");
      setFeedMessage(
        coordinatesChanged
          ? "Recalculando radar para la nueva estación…"
          : "Actualizando contactos para el nuevo alcance…",
      );
      setRuntimeMode("connecting");
    }

    if (patch.orientationMode === "course") {
      setCourseRetryKey((key) => key + 1);
    }
    setSettings(next);
  }, []);

  // Course-up follows foreground GPS travel direction only after the user
  // explicitly enables it. No background location task is registered.
  useEffect(() => {
    if (!isHydrated || settings.orientationMode !== "course") {
      setCourseHeadingDeg(null);
      setCourseStatus("off");
      return;
    }
    if (!appIsActive) {
      setCourseHeadingDeg(null);
      setCourseStatus("paused");
      return;
    }

    let alive = true;
    let subscription: Location.LocationSubscription | null = null;
    let previousSample: CourseSample | null = null;
    let courseExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStationSync = Date.now();
    setCourseHeadingDeg(null);
    setCourseStatus("waiting");

    const onPosition = (position: Location.LocationObject) => {
      if (!alive) return;
      const { latitude, longitude, heading, speed, accuracy } = position.coords;
      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        return;
      }

      const sample: CourseSample = {
        latitude,
        longitude,
        timestamp: position.timestamp,
        headingDeg: heading,
        speedMps: speed,
        accuracyM: accuracy,
      };
      const previous = previousSample;
      const course = estimateCourse(previous, sample);
      if (course !== null) {
        previousSample = sample;
        setCourseHeadingDeg((previous) =>
          previous === null ? course : smoothCourse(previous, course),
        );
        setCourseStatus("active");
        if (courseExpiryTimer) clearTimeout(courseExpiryTimer);
        courseExpiryTimer = setTimeout(() => {
          if (!alive) return;
          setCourseHeadingDeg(null);
          setCourseStatus("waiting");
        }, COURSE_STALE_AFTER_MS);
      } else if (
        previous === null ||
        sample.timestamp - previous.timestamp > COURSE_MAX_SAMPLE_GAP_MS ||
        (sample.accuracyM !== null && sample.accuracyM > 35) ||
        (previous.accuracyM !== null && previous.accuracyM > 35)
      ) {
        // Keep short, good fixes as the baseline until they accumulate enough
        // displacement; reset only when the sample interval or accuracy fails.
        previousSample = sample;
      }

      const now = Date.now();
      if (now - lastStationSync >= 60_000) {
        lastStationSync = now;
        const station = settingsRef.current;
        if (
          haversineM(station.ownLat, station.ownLon, latitude, longitude) >= 25
        ) {
          updateSettings({ ownLat: latitude, ownLon: longitude });
        }
      }
    };

    const start = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!alive) return;
      if (!permission.granted) {
        setCourseStatus("error");
        return;
      }

      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!alive) return;
      onPosition(initial);
      const watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 2500,
          distanceInterval: 3,
        },
        onPosition,
        () => {
          if (alive) {
            if (courseExpiryTimer) clearTimeout(courseExpiryTimer);
            setCourseHeadingDeg(null);
            setCourseStatus("error");
          }
        },
      );
      if (!alive) {
        watcher.remove();
        return;
      }
      subscription = watcher;
    };

    void start().catch(() => {
      if (alive) {
        if (courseExpiryTimer) clearTimeout(courseExpiryTimer);
        setCourseHeadingDeg(null);
        setCourseStatus("error");
      }
    });

    return () => {
      alive = false;
      if (courseExpiryTimer) clearTimeout(courseExpiryTimer);
      subscription?.remove();
    };
  }, [
    appIsActive,
    courseRetryKey,
    isHydrated,
    settings.orientationMode,
    updateSettings,
  ]);

  const resetSettings = useCallback(() => {
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    historyRef.current.clear();
    prevNearRef.current.clear();
    cooldownRef.current.clear();
    uasSeenRef.current.clear();
    setSelectedId(null);
    setContacts([]);
    setLastUpdate(null);
    setRuntimeMode("connecting");
    setFeedStatus("connecting");
    setFeedMessage("Estableciendo enlace con OpenSky…");
  }, []);

  const selectContact = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const enrichedContacts = useMemo(
    () =>
      contacts.map((contact) =>
        enrichContact(
          contact,
          settings,
          historyRef.current.get(contact.id) ?? [],
        ),
      ),
    [contacts, settings],
  );

  const visibleContacts = useMemo(
    () =>
      enrichedContacts
        .filter((contact) => contact.isVisible)
        .sort((a, b) => a.distanceM - b.distanceM),
    [enrichedContacts],
  );

  const metrics = useMemo<RadarMetrics>(
    () => ({
      total: visibleContacts.length,
      near: visibleContacts.filter((contact) => contact.isNear).length,
      uas: visibleContacts.filter((contact) => contact.uas).length,
      hidden: Math.max(0, enrichedContacts.length - visibleContacts.length),
    }),
    [enrichedContacts.length, visibleContacts],
  );

  const selectedContact = useMemo(
    () =>
      selectedId
        ? (visibleContacts.find((contact) => contact.id === selectedId) ?? null)
        : null,
    [selectedId, visibleContacts],
  );

  const feed = useMemo<FeedState>(
    () => ({
      mode: runtimeMode,
      status: feedStatus,
      lastUpdate,
      message: feedMessage,
    }),
    [runtimeMode, feedStatus, lastUpdate, feedMessage],
  );

  const hazards = useMemo<HazardView[]>(
    () =>
      rawHazards
        .map((hazard) =>
          viewHazard(
            hazard,
            settings.ownLat,
            settings.ownLon,
            settings.rangeM,
            settings.thresholdM,
          ),
        )
        .sort((a, b) => a.distanceM - b.distanceM),
    [rawHazards, settings.ownLat, settings.ownLon, settings.rangeM, settings.thresholdM],
  );

  const value = useMemo<RadarContextValue>(
    () => ({
      settings,
      contacts: enrichedContacts,
      visibleContacts,
      alerts,
      feed,
      courseHeadingDeg,
      courseStatus,
      metrics,
      selectedId,
      selectedContact,
      isHydrated,
      hazards,
      spaceWeather,
      hazardsError,
      updateSettings,
      resetSettings,
      selectContact,
      clearAlerts,
      refresh,
    }),
    [
      settings,
      enrichedContacts,
      visibleContacts,
      alerts,
      feed,
      courseHeadingDeg,
      courseStatus,
      metrics,
      selectedId,
      selectedContact,
      isHydrated,
      hazards,
      spaceWeather,
      hazardsError,
      updateSettings,
      resetSettings,
      selectContact,
      clearAlerts,
      refresh,
    ],
  );

  return <RadarContext.Provider value={value}>{children}</RadarContext.Provider>;
}

export function useRadar(): RadarContextValue {
  const context = useContext(RadarContext);
  if (!context) {
    throw new Error("useRadar must be used inside a RadarProvider");
  }
  return context;
}
