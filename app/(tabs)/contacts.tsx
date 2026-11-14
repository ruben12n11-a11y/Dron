import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Badge,
  Chip,
  GhostButton,
  Page,
  PageHeader,
} from "@/components/hud";
import { ContactModal } from "@/components/radar/ContactDetail";
import { RADAR } from "@/constants/radar-theme";
import {
  bearingToCompass,
  formatAltitude,
  formatBearing,
  formatDistance,
  formatSpeed,
} from "@/lib/radar/geo";
import { useRadar } from "@/lib/radar/store";
import type { EnrichedContact } from "@/lib/radar/types";

type ContactFilter = "all" | "near" | "far" | "uas";

function ContactRow({
  contact,
  thresholdM,
  rangeM,
  onPress,
}: {
  contact: EnrichedContact;
  thresholdM: number;
  rangeM: number;
  onPress: () => void;
}) {
  const statusColor = contact.isNear
    ? RADAR.colors.red
    : RADAR.colors.green;
  const distanceFraction = Math.min(1, contact.distanceM / Math.max(1, rangeM));
  const thresholdFraction = Math.min(1, thresholdM / Math.max(1, rangeM));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver detalle de ${contact.callsign}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.72 }]}
    >
      <View style={[styles.rowAccent, { backgroundColor: statusColor }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={styles.identity}>
            <Text style={styles.callsign} numberOfLines={1}>
              {contact.callsign}
            </Text>
            <Text style={styles.icao}>
              {contact.icao} · {contact.category ?? "SIN CATEGORÍA"}
            </Text>
          </View>
          <View style={styles.distanceGroup}>
            <Text style={[styles.distance, { color: statusColor }]}>
              {formatDistance(contact.distanceM)}
            </Text>
            <Text style={styles.distanceStatus}>
              {contact.isNear ? "CERCANO" : "LEJANO"}
            </Text>
          </View>
        </View>

        <View style={styles.badgeRow}>
          <Badge
            label={contact.uas ? "POSIBLE UAS" : "AERONAVE"}
            tone={contact.uas ? "red" : "cyan"}
          />
          <Badge
            label="OPEN SKY · ADS-B"
            tone="muted"
          />
          {contact.turnDeg > 150 ? (
            <Badge label={`GIRO ${Math.round(contact.turnDeg)}°`} tone="amber" />
          ) : null}
        </View>

        <View style={styles.dataRow}>
          <View style={styles.dataItem}>
            <MaterialIcons
              name="navigation"
              size={11}
              color={RADAR.colors.cyanDim}
              style={{ transform: [{ rotate: `${contact.bearingDeg}deg` }] }}
            />
            <Text style={styles.dataLabel}>RUMBO</Text>
            <Text style={styles.dataValue}>
              {formatBearing(contact.bearingDeg)} {bearingToCompass(contact.bearingDeg)}
            </Text>
          </View>
          <View style={styles.dataItem}>
            <MaterialIcons
              name="vertical-align-top"
              size={11}
              color={RADAR.colors.cyanDim}
            />
            <Text style={styles.dataLabel}>ALT</Text>
            <Text style={styles.dataValue}>{formatAltitude(contact.altFt)}</Text>
          </View>
          <View style={styles.dataItem}>
            <MaterialIcons name="speed" size={11} color={RADAR.colors.cyanDim} />
            <Text style={styles.dataLabel}>VEL</Text>
            <Text style={styles.dataValue}>{formatSpeed(contact.speedKt)}</Text>
          </View>
        </View>

        <View style={styles.distanceTrack}>
          <View
            style={[
              styles.distanceFill,
              {
                width: `${Math.max(2, distanceFraction * 100)}%`,
                backgroundColor: statusColor,
              },
            ]}
          />
          <View
            style={[
              styles.thresholdMarker,
              { left: `${thresholdFraction * 100}%` },
            ]}
          />
        </View>
      </View>
      <MaterialIcons
        name="chevron-right"
        size={17}
        color={RADAR.colors.mutedDark}
      />
    </Pressable>
  );
}

export default function ContactsScreen() {
  const router = useRouter();
  const {
    settings,
    visibleContacts,
    selectContact,
    feed,
    refresh,
  } = useRadar();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [modalContactId, setModalContactId] = useState<string | null>(null);

  const modalContact = useMemo(
    () =>
      modalContactId
        ? (visibleContacts.find((contact) => contact.id === modalContactId) ??
          null)
        : null,
    [modalContactId, visibleContacts],
  );

  const changeFilter = (next: ContactFilter) => {
    setFilter(next);
    setModalContactId(null);
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    setModalContactId(null);
  };

  const counts = useMemo(
    () => ({
      all: visibleContacts.length,
      near: visibleContacts.filter((contact) => contact.isNear).length,
      far: visibleContacts.filter((contact) => !contact.isNear).length,
      uas: visibleContacts.filter((contact) => contact.uas).length,
    }),
    [visibleContacts],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return visibleContacts.filter((contact) => {
      if (filter === "near" && !contact.isNear) return false;
      if (filter === "far" && contact.isNear) return false;
      if (filter === "uas" && !contact.uas) return false;
      if (!normalized) return true;
      return (
        contact.callsign.toLowerCase().includes(normalized) ||
        contact.icao.toLowerCase().includes(normalized) ||
        (contact.category ?? "").toLowerCase().includes(normalized)
      );
    });
  }, [filter, query, visibleContacts]);

  const focusContact = (contact: EnrichedContact) => {
    selectContact(contact.id);
    setModalContactId(null);
    router.navigate("/");
  };

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          eyebrow="DRONE RADAR // CONTACTOS"
          title="Contactos"
          subtitle="Tráfico visible ordenado por distancia a la estación."
          right={<Badge label={`${counts.all} VISIBLES`} tone="cyan" />}
        />

        <View style={styles.searchBox}>
          <MaterialIcons name="search" size={16} color={RADAR.colors.muted} />
          <TextInput
            value={query}
            onChangeText={changeQuery}
            placeholder="Buscar callsign, ICAO o categoría"
            placeholderTextColor={RADAR.colors.mutedDark}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="Buscar contactos"
          />
          {query ? (
            <Pressable
              onPress={() => changeQuery("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda"
            >
              <MaterialIcons
                name="close"
                size={15}
                color={RADAR.colors.muted}
              />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <Chip
            label="TODOS"
            count={counts.all}
            active={filter === "all"}
            onPress={() => changeFilter("all")}
          />
          <Chip
            label="CERCANOS"
            count={counts.near}
            active={filter === "near"}
            onPress={() => changeFilter("near")}
            tone="red"
          />
          <Chip
            label="LEJANOS"
            count={counts.far}
            active={filter === "far"}
            onPress={() => changeFilter("far")}
          />
          <Chip
            label="UAS"
            count={counts.uas}
            active={filter === "uas"}
            onPress={() => changeFilter("uas")}
            tone="amber"
          />
        </ScrollView>

        <View style={styles.listHeader}>
          <Text style={styles.listCount}>
            {filtered.length} CONTACTO{filtered.length === 1 ? "" : "S"}
          </Text>
          <Text style={styles.listSort}>ORDEN: DISTANCIA ↑</Text>
        </View>

        {feed.status === "error" && visibleContacts.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons
              name="cloud-off"
              size={38}
              color={RADAR.colors.red}
            />
            <Text style={styles.emptyTitle}>SIN ENLACE OPEN SKY</Text>
            <Text style={styles.emptyText}>{feed.message}</Text>
            <GhostButton label="REINTENTAR" onPress={refresh} />
          </View>
        ) : feed.mode === "connecting" && visibleContacts.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator size="small" color={RADAR.colors.cyan} />
            <Text style={styles.emptyTitle}>ADQUIRIENDO SEÑAL</Text>
            <Text style={styles.emptyText}>
              Consultando OpenSky. Solo se mostrarán contactos ADS-B reales que
              superen la validación de origen y frescura.
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons
              name="radar"
              size={38}
              color={RADAR.colors.mutedDark}
            />
            <Text style={styles.emptyTitle}>SIN CONTACTOS VISIBLES</Text>
            <Text style={styles.emptyText}>
              Ajusta el alcance, la altitud mínima o la velocidad mínima para
              ampliar la vigilancia.
            </Text>
            <GhostButton
              label="ABRIR AJUSTES"
              onPress={() => router.push("/settings")}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                thresholdM={settings.thresholdM}
                rangeM={settings.rangeM}
                onPress={() => setModalContactId(contact.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <ContactModal
        contact={modalContact}
        onClose={() => setModalContactId(null)}
        onFocus={focusContact}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 10,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: RADAR.fonts.mono,
    fontSize: 12,
    color: RADAR.colors.text,
    paddingVertical: 0,
  },
  filters: {
    gap: 6,
    paddingVertical: 1,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  listCount: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: RADAR.colors.cyanDim,
  },
  listSort: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.8,
    color: RADAR.colors.muted,
  },
  list: {
    gap: 7,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    paddingRight: 8,
    overflow: "hidden",
  },
  rowAccent: {
    width: 3,
    alignSelf: "stretch",
  },
  rowBody: {
    flex: 1,
    paddingVertical: 9,
    paddingLeft: 1,
    gap: 6,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  identity: {
    flex: 1,
  },
  callsign: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: 0.4,
    color: RADAR.colors.text,
  },
  icao: {
    marginTop: 1,
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.6,
    color: RADAR.colors.muted,
  },
  distanceGroup: {
    alignItems: "flex-end",
  },
  distance: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 16,
    lineHeight: 18,
  },
  distanceStatus: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.8,
    color: RADAR.colors.muted,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dataItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  dataLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 0.6,
    color: RADAR.colors.muted,
  },
  dataValue: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    color: RADAR.colors.textDim,
  },
  distanceTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: RADAR.colors.border,
    overflow: "visible",
    position: "relative",
  },
  distanceFill: {
    height: 3,
    borderRadius: 2,
  },
  thresholdMarker: {
    position: "absolute",
    top: -2,
    width: 1,
    height: 7,
    backgroundColor: RADAR.colors.amber,
    opacity: 0.8,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.md,
    backgroundColor: RADAR.colors.panel,
    paddingVertical: 32,
    paddingHorizontal: 20,
    marginTop: 6,
  },
  emptyTitle: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 13,
    letterSpacing: 1.2,
    color: RADAR.colors.textDim,
  },
  emptyText: {
    maxWidth: 280,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 16,
    color: RADAR.colors.muted,
  },
});
