import { ActivityIndicator, Text, View } from "react-native";

import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

export default function Index() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.container} testID="splash-screen">
      <Text style={styles.logo}>THELOOKCRAFT</Text>
      <ActivityIndicator color={colors.onSurface} style={{ marginTop: spacing.xl }} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface },
  logo: { fontSize: fontSize["2xl"], fontWeight: "900", letterSpacing: 4, color: c.onSurface },
}));
