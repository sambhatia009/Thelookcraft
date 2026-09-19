import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { BookmarkSimple, Sparkle, TShirt, User } from "phosphor-react-native";

import { usesNativeTabs } from "@/src/navigation";
import { useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();

  if (usesNativeTabs) {
    const { NativeTabs } = require("expo-router/unstable-native-tabs");
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="square.grid.2x2" />
          <NativeTabs.Trigger.Label>Closet</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="stylist">
          <NativeTabs.Trigger.Icon sf="sparkles" />
          <NativeTabs.Trigger.Label>Stylist</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="lookbook">
          <NativeTabs.Trigger.Icon sf="bookmark" />
          <NativeTabs.Trigger.Label>Lookbook</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon sf="person" />
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onSurface,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Closet", tabBarIcon: ({ color }) => <TShirt color={color} size={22} weight="regular" /> }}
      />
      <Tabs.Screen
        name="stylist"
        options={{ title: "Stylist", tabBarIcon: ({ color }) => <Sparkle color={color} size={22} weight="regular" /> }}
      />
      <Tabs.Screen
        name="lookbook"
        options={{ title: "Lookbook", tabBarIcon: ({ color }) => <BookmarkSimple color={color} size={22} weight="regular" /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color }) => <User color={color} size={22} weight="regular" /> }}
      />
    </Tabs>
  );
}
