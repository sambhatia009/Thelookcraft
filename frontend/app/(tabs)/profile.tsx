import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button, Chip } from "@/src/ui";

const DRESS_CODES = ["Minimalist", "Smart Casual", "Business Casual", "Streetwear", "Formal"];
const WEATHERS = ["Cold", "Temperate", "Hot"];
const PALETTES = ["Navy", "White", "Charcoal", "Black", "Beige", "Olive", "Burgundy", "Camel"];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const { show } = useToast();

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => api.profile() });

  const update = async (patch: any) => {
    try {
      await api.updateProfile(patch);
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch {
      show("Could not update preferences", "error");
    }
  };

  const togglePalette = (color: string) => {
    const current: string[] = profile?.color_palette || [];
    const next = current.includes(color) ? current.filter((x) => x !== color) : [...current, color];
    update({ color_palette: next });
  };

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const initial = (user?.name || user?.email || "S").charAt(0).toUpperCase();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>PROFILE</Text>
      </View>
      <View style={styles.hairlineStrong} />

      <ScrollView contentContainerStyle={{ paddingBottom: bottomChrome + spacing.xl }}>
        <View style={styles.idRow}>
          <View style={styles.avatar}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name || "Stylist"}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          {["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"].map((c) => (
            <View key={c} style={styles.stat}>
              <Text style={styles.statNum}>{profile?.counts?.[c] ?? 0}</Text>
              <Text style={styles.statLabel}>{c}</Text>
            </View>
          ))}
        </View>

        <Section title="DRESS CODE DEFAULTS">
          <View style={styles.chipWrap}>
            {DRESS_CODES.map((d) => (
              <Chip key={d} label={d} active={profile?.dress_code === d} onPress={() => update({ dress_code: d })} testID={`dress-${d}`} />
            ))}
          </View>
        </Section>

        <Section title="WEATHER CONTEXT">
          <View style={styles.chipWrap}>
            {WEATHERS.map((w) => (
              <Chip key={w} label={w} active={profile?.weather === w} onPress={() => update({ weather: w })} testID={`weather-${w}`} />
            ))}
          </View>
        </Section>

        <Section title="COLOR PALETTE">
          <View style={styles.chipWrap}>
            {PALETTES.map((p) => (
              <Chip key={p} label={p} active={(profile?.color_palette || []).includes(p)} onPress={() => togglePalette(p)} testID={`palette-${p}`} />
            ))}
          </View>
        </Section>

        <View style={{ padding: spacing.lg }}>
          <Button title="Sign Out" variant="outline" onPress={signOut} testID="sign-out-btn" />
        </View>
        <Text style={styles.themeNote}>THEME FOLLOWS YOUR DEVICE · LIGHT & DARK</Text>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
      <View style={styles.hairline} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: fontSize["3xl"], fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  hairline: { height: 1, backgroundColor: c.border },
  hairlineStrong: { height: 1, backgroundColor: c.borderStrong },
  idRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, padding: spacing.lg },
  avatar: { width: 72, height: 72, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { fontSize: fontSize["2xl"], fontWeight: "900", color: c.onBrandPrimary },
  name: { fontSize: fontSize.xl, fontWeight: "800", color: c.onSurface, letterSpacing: 0.3 },
  email: { fontSize: fontSize.base, color: c.muted, marginTop: 2 },
  statsRow: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.lg, borderRightWidth: 1, borderRightColor: c.border },
  statNum: { fontSize: fontSize.xl, fontWeight: "900", color: c.onSurface },
  statLabel: { fontSize: 9, color: c.muted, letterSpacing: 0.5, marginTop: 2, textTransform: "uppercase" },
  sectionTitle: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  sectionBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  themeNote: { textAlign: "center", color: c.muted, fontSize: fontSize.sm, letterSpacing: 1, paddingBottom: spacing.lg },
}));
