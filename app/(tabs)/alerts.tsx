import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useMemo, useState, type ComponentProps } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Badge,
  Chip,
  GhostButton,
  Page,
  PageHeader,
} from "@/components/hud";
import { RADAR } from "@/constants/radar-theme";
import {
  alertColor,
  alertKindLabel,
  severityLabel,
} from "@/lib/radar/alert-meta";
import {
  formatAltitude,
  formatClock,
  formatDistance,
  formatRelative,
  formatSpeed,
} from "@/lib/radar/geo";
import { useRadar } from "@/lib/radar/store";
import type { AlertKind, RadarAlert } from "@/lib/radar/types";

type AlertFilter = "all" | AlertKind;

const KIND_ICONS: Record<AlertKind, ComponentProps<typeof MaterialIcons>["name"]> = {
  proximity: "warning",
  turn: "sync-alt",
  uas: "flight",
  hazard: "local-fire-department",
  system: "info-outline",
};

function badgeTone(alert: RadarAlert): "red" | "amber" | "cyan" {
  if (alert.severity === "critical") return "red";
  if (alert.severity === "warning") return "amber";
  return "cyan";
}

function AlertCard({
  alert,
  isLast,
  onFocusContact,
  canFocus,
}: {
  alert: RadarAlert;
  isLast: boolean;
  onFocusContact: (alert: RadarAlert) => void;
  canFocus: boolean;
}) {
  const color = alertColor(alert.severity);
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timeline}>
        <View style={[styles.node, { borderColor: color }]}>
          <View style={[styles.nodeCore, { backgroundColor: color }]} />
        </View>
        {!isLast ? <View style={styles.timelineLine} /> : null}
      </View>

      <View style={[styles.alertCard, { borderLeftColor: color }]}>
        <View style={styles.cardTop}>
          <View style={styles.kindGroup}>
            <MaterialIcons
              name={KIND_ICONS[alert.kind]}
              size={12}
              color={color}
            />
            <Text style={[styles.kind, { color }]}>
              {alertKindLabel(alert.kind)}
            </Text>
          </View>
          <View style={styles.cardTopRight}>
            <Badge label={severityLabel(alert.severity)} tone={badgeTone(alert)} />
            <Text style={styles.time}>{formatClock(alert.timestamp)}</Text>
          </View>
        </View>

        <Text style={styles.title}>{alert.title}</Text>
        <Text style={styles.message}>{alert.message}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.relative}>{formatRelative(alert.timestamp)}</Text>
          {alert.callsign ? (
            <Text style={styles.meta}>{alert.callsign}</Text>
          ) : null}
          {typeof alert.distanceM === "number" ? (
            <Text style={styles.meta}>{formatDistance(alert.distanceM)}</Text>
          ) : null}
          {typeof alert.altFt === "number" ? (
            <Text style={styles.meta}>{formatAltitude(alert.altFt)}</Text>
          ) : null}
          {typeof alert.speedKt === "number" ? (
            <Text style={styles.meta}>{formatSpeed(alert.speedKt)}</Text>
          ) : null}
        </View>

        {alert.contactId && canFocus ? (
          <Pressable
            onPress={() => onFocusContact(alert)}
            accessibilityRole="button"
            accessibilityLabel={`Ver ${alert.callsign ?? "contacto"} en el radar`}
            style={({ pressed }) => [
              styles.focusButton,
              pressed && { opacity: 0.65 },
            ]}
          >
            <MaterialIcons
              name="my-location"
              size={12}
              color={RADAR.colors.cyan}
            />
            <Text style={styles.focusText}>VER CONTACTO EN RADAR</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ClearConfirmModal({
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
          <View style={styles.confirmIcon}>
            <MaterialIcons
              name="delete-outline"
              size={22}
              color={RADAR.colors.red}
            />
          </View>
          <Text style={styles.confirmTitle}>¿DEPURAR REGISTRO?</Text>
          <Text style={styles.confirmText}>
            Se eliminarán todas las alertas guardadas en este dispositivo. La
            vigilancia continuará activa.
          </Text>
          <View style={styles.confirmActions}>
            <View style={{ flex: 1 }}>
              <GhostButton label="CANCELAR" onPress={onCancel} tone="muted" />
            </View>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirmar borrado de alertas"
              style={({ pressed }) => [
                styles.dangerButton,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text style={styles.dangerText}>DEPURAR</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function AlertsScreen() {
  const router = useRouter();
  const { alerts, clearAlerts, visibleContacts, selectContact } = useRadar();
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [confirmVisible, setConfirmVisible] = useState(false);

  const counts = useMemo(
    () => ({
      all: alerts.length,
      proximity: alerts.filter((alert) => alert.kind === "proximity").length,
      turn: alerts.filter((alert) => alert.kind === "turn").length,
      uas: alerts.filter((alert) => alert.kind === "uas").length,
      hazard: alerts.filter((alert) => alert.kind === "hazard").length,
      system: alerts.filter((alert) => alert.kind === "system").length,
    }),
    [alerts],
  );

  const filtered = useMemo(
    () =>
      filter === "all"
        ? alerts
        : alerts.filter((alert) => alert.kind === filter),
    [alerts, filter],
  );

  const visibleIds = useMemo(
    () => new Set(visibleContacts.map((contact) => contact.id)),
    [visibleContacts],
  );

  const focusContact = (alert: RadarAlert) => {
    if (!alert.contactId) return;
    const contact = visibleContacts.find((item) => item.id === alert.contactId);
    if (!contact) return;
    selectContact(contact.id);
    router.navigate("/");
  };

  const confirmClear = () => {
    clearAlerts();
    setConfirmVisible(false);
  };

  return (
    <Page>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <PageHeader
          eyebrow="DRONE RADAR // ALERTAS"
          title="Alertas"
          subtitle="Proximidad, reversión de trayectoria e indicios UAS."
          right={
            alerts.length > 0 ? (
              <GhostButton
                label="LIMPIAR"
                onPress={() => setConfirmVisible(true)}
                tone="red"
              />
            ) : (
              <Badge label="REGISTRO VACÍO" tone="muted" />
            )
          }
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <Chip
            label="TODAS"
            count={counts.all}
            active={filter === "all"}
            onPress={() => setFilter("all")}
          />
          <Chip
            label="PROXIMIDAD"
            count={counts.proximity}
            active={filter === "proximity"}
            onPress={() => setFilter("proximity")}
            tone="red"
          />
          <Chip
            label="TRAYECTORIA"
            count={counts.turn}
            active={filter === "turn"}
            onPress={() => setFilter("turn")}
            tone="amber"
          />
          <Chip
            label="UAS"
            count={counts.uas}
            active={filter === "uas"}
            onPress={() => setFilter("uas")}
            tone="red"
          />
          <Chip
            label="NASA"
            count={counts.hazard}
            active={filter === "hazard"}
            onPress={() => setFilter("hazard")}
            tone="amber"
          />
          <Chip
            label="SISTEMA"
            count={counts.system}
            active={filter === "system"}
            onPress={() => setFilter("system")}
          />
        </ScrollView>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons
              name="notifications-none"
              size={38}
              color={RADAR.colors.mutedDark}
            />
            <Text style={styles.emptyTitle}>SIN ALERTAS</Text>
            <Text style={styles.emptyText}>
              El radar está vigilando. Las alertas aparecerán aquí cuando un
              contacto cruce el umbral o maniobre de forma anómala.
            </Text>
          </View>
        ) : (
          <View style={styles.timelineList}>
            {filtered.map((alert, index) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                isLast={index === filtered.length - 1}
                onFocusContact={focusContact}
                canFocus={
                  alert.contactId ? visibleIds.has(alert.contactId) : false
                }
              />
            ))}
          </View>
        )}
      </ScrollView>

      <ClearConfirmModal
        visible={confirmVisible}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={confirmClear}
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
  filters: {
    gap: 6,
    paddingVertical: 1,
  },
  timelineList: {
    marginTop: 2,
  },
  timelineRow: {
    flexDirection: "row",
    gap: 8,
  },
  timeline: {
    width: 16,
    alignItems: "center",
    paddingTop: 8,
  },
  node: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: RADAR.colors.bg,
  },
  nodeCore: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: RADAR.colors.border,
    marginTop: 3,
    marginBottom: -8,
  },
  alertCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderLeftWidth: 2,
    borderRadius: RADAR.radius.sm,
    backgroundColor: RADAR.colors.panel,
    padding: 10,
    marginBottom: 8,
    gap: 4,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  kindGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  kind: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
  },
  cardTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  time: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.muted,
  },
  title: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 14,
    lineHeight: 17,
    color: RADAR.colors.text,
  },
  message: {
    fontSize: 10,
    lineHeight: 15,
    color: RADAR.colors.textDim,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    paddingTop: 5,
    borderTopWidth: 1,
    borderColor: RADAR.colors.border,
  },
  relative: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.cyanDim,
  },
  meta: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    color: RADAR.colors.muted,
  },
  focusButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 3,
    paddingVertical: 3,
  },
  focusText: {
    fontFamily: RADAR.fonts.mono,
    fontSize: 8,
    letterSpacing: 0.8,
    color: RADAR.colors.cyan,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: RADAR.colors.border,
    borderRadius: RADAR.radius.md,
    backgroundColor: RADAR.colors.panel,
    paddingVertical: 34,
    paddingHorizontal: 22,
    marginTop: 6,
  },
  emptyTitle: {
    fontFamily: RADAR.fonts.displaySemi,
    fontSize: 13,
    letterSpacing: 1.2,
    color: RADAR.colors.textDim,
  },
  emptyText: {
    maxWidth: 290,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 16,
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
  confirmIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: RADAR.colors.red,
    backgroundColor: RADAR.colors.redFaint,
    alignItems: "center",
    justifyContent: "center",
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
