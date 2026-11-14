import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { RADAR } from "@/constants/radar-theme";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom, 8);
  const tabBarHeight = 58 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: RADAR.colors.cyan,
        tabBarInactiveTintColor: RADAR.colors.muted,
        tabBarButton: HapticTab,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          paddingTop: 6,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: RADAR.colors.bgDeep,
          borderTopColor: RADAR.colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontFamily: RADAR.fonts.displaySemi,
          fontSize: 9,
          letterSpacing: 1.1,
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginTop: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "RADAR",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="radar" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: "CONTACTOS",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="view-list" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "ALERTAS",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="notifications-none" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="nasa"
        options={{
          title: "NASA",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="public" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "AJUSTES",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="tune" size={size - 3} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
