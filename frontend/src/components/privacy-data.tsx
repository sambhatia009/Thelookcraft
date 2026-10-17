import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Linking, Modal, Platform, Pressable, Text, View } from "react-native";

import { ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing } from "@/src/theme";
import { Button } from "@/src/ui";

// Public site lives on the brand domain (GitHub Pages) — always reachable, independent of the backend host.
export const PRIVACY_URL = "https://thelookcraft.com/privacy";
export const DELETE_REQUEST_URL = "https://thelookcraft.com/delete-account";

function openLink(url: string) {
  if (Platform.OS === "web") return Linking.openURL(url);
  return WebBrowser.openBrowserAsync(url);
}

type Mode = "disable" | "delete";

/** Profile → Privacy & Data: policy link, disable (reversible) or permanently delete the account. */
export function PrivacyAndData() {
  const styles = useStyles();
  const { show } = useToast();
  const { closeAccount } = useAuth();
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!mode) return;
    setBusy(true);
    try {
      await closeAccount(mode);
      show(mode === "delete" ? "Your account and data have been deleted" : "Account disabled — sign in any time to reactivate", "success");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Could not complete the request. Please try again.", "error");
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="privacy-section">
      <Pressable onPress={() => openLink(PRIVACY_URL)} style={styles.link} testID="privacy-policy-link">
        <Text style={styles.linkText}>PRIVACY POLICY</Text>
        <Text style={styles.arrow}>→</Text>
      </Pressable>
      <Pressable onPress={() => setMode("disable")} style={styles.link} testID="disable-account-btn">
        <View style={{ flex: 1 }}>
          <Text style={styles.linkText}>DISABLE ACCOUNT</Text>
          <Text style={styles.hint}>Hide it and sign out everywhere. Sign in again to reactivate.</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </Pressable>
      <Pressable onPress={() => setMode("delete")} style={styles.link} testID="delete-account-btn">
        <View style={{ flex: 1 }}>
          <Text style={[styles.linkText, styles.danger]}>DELETE ACCOUNT & DATA</Text>
          <Text style={styles.hint}>Permanently removes your profile, photos, looks and feedback.</Text>
        </View>
        <Text style={[styles.arrow, styles.danger]}>→</Text>
      </Pressable>
      <Pressable onPress={() => openLink(DELETE_REQUEST_URL)} testID="delete-request-link" style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={styles.fine}>
          You can also request deletion without the app at {DELETE_REQUEST_URL.replace(/^https?:\/\//, "")}
        </Text>
      </Pressable>

      <Modal visible={mode !== null} transparent animationType="fade" onRequestClose={() => !busy && setMode(null)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setMode(null)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="account-confirm-sheet">
            <Text style={styles.sheetTitle}>{mode === "delete" ? "DELETE ACCOUNT & DATA?" : "DISABLE ACCOUNT?"}</Text>
            <Text style={styles.sheetBody}>
              {mode === "delete"
                ? "This permanently deletes your account, every closet photo, saved look, feedback and preferences. It cannot be undone."
                : "Your account will be hidden and you'll be signed out on every device. Nothing is deleted — sign in again whenever you like to pick up where you left off."}
            </Text>
            <Button
              title={mode === "delete" ? "Delete Permanently" : "Disable Account"}
              onPress={confirm}
              loading={busy}
              testID="account-confirm-btn"
            />
            <Button title="Cancel" variant="outline" onPress={() => setMode(null)} disabled={busy} style={{ marginTop: spacing.sm }} testID="account-cancel-btn" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { paddingHorizontal: spacing.lg },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  linkText: { flex: 1, fontSize: fontSize.sm, letterSpacing: 2, fontWeight: "700", color: c.onSurface },
  hint: { fontSize: fontSize.sm, color: c.muted, marginTop: spacing.xs, lineHeight: 18 },
  arrow: { fontSize: fontSize.base, color: c.onSurface },
  danger: { color: c.error },
  fine: { fontSize: 11, color: c.muted, marginTop: spacing.md, lineHeight: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, padding: spacing.xl, paddingBottom: spacing["3xl"], borderTopWidth: 1, borderTopColor: c.onSurface },
  sheetTitle: { fontSize: fontSize.base, letterSpacing: 2, fontWeight: "900", color: c.onSurface },
  sheetBody: { fontSize: fontSize.base, lineHeight: 21, color: c.onSurfaceSecondary, marginVertical: spacing.lg },
}));
