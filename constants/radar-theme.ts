/**
 * Drone Radar visual system.
 *
 * A single dark tactical palette keeps the radar legible outdoors and on OLED
 * screens. Cyan is the instrument color, red is reserved for proximity, and
 * green marks contacts outside the alert ring.
 */
export const RADAR = {
  colors: {
    bg: "#04070B",
    bgDeep: "#020406",
    panel: "#081017",
    panelRaised: "#0B1620",
    panelSoft: "#0D1A24",
    border: "#15303D",
    borderStrong: "#1E4353",
    grid: "rgba(34, 211, 238, 0.12)",
    gridStrong: "rgba(34, 211, 238, 0.28)",
    cyan: "#22D3EE",
    cyanSoft: "#7DEBFA",
    cyanDim: "#0E7490",
    cyanFaint: "rgba(34, 211, 238, 0.08)",
    green: "#34D399",
    greenDim: "#065F46",
    red: "#FB3B53",
    redSoft: "#FF7A8A",
    redFaint: "rgba(251, 59, 83, 0.12)",
    amber: "#F5A524",
    amberSoft: "#FCD34D",
    amberFaint: "rgba(245, 165, 36, 0.12)",
    text: "#E7F6F8",
    textDim: "#A8C0C8",
    muted: "#64808B",
    mutedDark: "#3D5560",
    black: "#000000",
  },
  fonts: {
    display: "ChakraPetch-Bold",
    displaySemi: "ChakraPetch-SemiBold",
    displayMedium: "ChakraPetch-Medium",
    mono: "ShareTechMono",
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    pill: 999,
  },
} as const;

export type RadarPalette = typeof RADAR.colors;
