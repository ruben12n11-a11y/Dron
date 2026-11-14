import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { RADAR } from "@/constants/radar-theme";
import { Badge, CornerBrackets, PrimaryButton } from "@/components/hud";
import {
  bearingToCompass,
  formatAltitude,
  formatBearing,
  formatCoord,
  formatDistance,
  formatSpeed,
} from "@/lib/radar/geo";
import type { EnrichedContact } from "@/lib/radar/types";

function DataCell({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ComponentProps<typeof MaterialIcons>["name"];
}) {
  return (
    <View style={styles.dataCell}>
      <View style={styles.dataLabelRow}>
        {icon ? (
          <MaterialIcons name={icon} size={11} color={RADAR.colors.muted} />
        ) : null}
        <Text style={styles.dataLabel}>{label}</Text>
      </View>
      <Text style={styles.dataValue}>{value}</Text>
      {sub ? <Text style={styles.dataSub}>{sub}</Text> : null}
    </View>
  );
}

export function ContactDetailCard({
  contact,
  onClose,
}: {
  contact: EnrichedContact;
  onClose: () => void;
}) {
  const statusColor = contact.isNear
    ? RADAR.colors.red
    : RADAR.colors.green;

  return (
    <View style={styles.card}>
      <CornerBrackets color={statusColor} />
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleGroup}>
          <View style={styles.badgeRow}>
            <Badge
              label={contact.uas ? "POSIBLE UAS" : "AERONAVE"}
              tone={contact.uas ? "red" : "cyan"}
            />
            <Badge label="ADS-B REAL · OPEN SKY" tone="muted" />
          </View>
          <Text style={styles.callsign}>{contact.callsign}</Text>
          <Text style={styles.icao}>
            ICAO {contact.icao}
            {contact.category ? ` · ${contact.category}` : ""}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cerrar ficha de contacto"
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="close" size={18} color={RADAR.colors.textDim} />
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.statusBar, { backgroundColor: statusColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusLabel, { color: statusColor }]}>
            {contact.isNear ? "DENTRO DEL UMBRAL" : "FUERA DEL UMBRAL"}
          </Text>
          <Text style={styles.statusSub}>
            {contact.isNear
              ? "Contacto próximo a la estación"
              : "Contacto visible sin proximidad crítica"}
          </Text>
        </View>
        <View style={styles.distanceGroup}>
          <Text style={[styles.distanceValue, { color: statusColor }]}>
            {formatDistance(contact.distanceM)}
          </Text>
          <Text style={styles.distanceLabel}>DISTANCIA</Text>
        </View>
      </View>

      <View style={styles.dataGrid}>
        <DataCell
          label="RUMBO"
          value={formatBearing(contact.bearingDeg)}
          sub={bearingToCompass(contact.bearingDeg)}
          icon="navigation"
        />
        <DataCell
          label="ALTITUD"
          value={formatAltitude(contact.altFt)}
          sub={`${Math.round(contact.verticalRateFpm)} ft/min`}
          icon="vertical-align-top"
        />
        <DataCell
          label="VELOCIDAD"
          value={formatSpeed(contact.speedKt)}
          sub={contact.turnDeg > 0 ? `Giro ${Math.round(contact.turnDeg)}°` : "Sin giro detectado"}
          icon="speed"
        />
        <DataCell
          label="POSICIÓN"
          value={`${contact.lat.toFixed(4)}, ${contact.lon.toFixed(4)}`}
          sub={formatCoord(contact.lat, contact.lon)}
          icon="my-location"
        />
      </View>
    </View>
  );
}

export function ContactModal({
  contact,
  onClose,
  onFocus,
}: {
  contact: EnrichedContact | null;
  onClose: () => void;
  onFocus: (contact: EnrichedContact) => void;
}) {
  return (
    <Modal
      visible={contact !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.modalCard}
          onPress={(event) => event.stopPropagation()}
        >
          {contact ? (
            <ScrollView
              contentContainerStyle={{ gap: 14 }}
              showsVerticalScrollIndicator={false}
            >
              <ContactDetailCard contact={contact} onClose={onClose} />
              <PrimaryButton
                label="CENTRAR EN EL RADAR"
                onPress={() => onFocus(contact)}
              />
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    borderWidth: 1,
    borderColor: RADAR.colors.borderStrong,
    borderRadius: RADAR.radius.md,
    backgroundColor: RADAR.colors.panelRaised,
    padding: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitleGroup: {
    flex: 1,
    gap: 3,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  callsign: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 0.5,
    color: RADAR.colors.text,
  },
  icao: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    letterSpacing: 0.8,
    color: RADAR.colors.muted,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: RADAR.colors.border,
    paddingVertical: 9,
  },
  statusBar: {
    width: 3,
    height: 28,
    borderRadius: 2,
  },
  statusLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
  },
  statusSub: {
    marginTop: 2,
    fontSize: 10,
    color: RADAR.colors.muted,
  },
  distanceGroup: {
    alignItems: "flex-end",
  },
  distanceValue: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 22,
    lineHeight: 25,
  },
  distanceLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 7,
    letterSpacing: 1,
    color: RADAR.colors.muted,
  },
  dataGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
    columnGap: 8,
  },
  dataCell: {
    width: "47.5%",
    minWidth: 130,
    gap: 1,
  },
  dataLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  dataLabel: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: RADAR.colors.muted,
  },
  dataValue: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 13,
    color: RADAR.colors.text,
  },
  dataSub: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 9,
    color: RADAR.colors.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 4, 6, 0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "82%",
    backgroundColor: RADAR.colors.bg,
    borderWidth: 1,
    borderColor: RADAR.colors.borderStrong,
    borderRadius: RADAR.radius.lg,
    padding: 10,
  },
});
