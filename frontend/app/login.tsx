import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { ApiError } from "@/src/api";
import { ForgotPassword } from "@/src/components/forgot-password";
import { useToast } from "@/src/toast";
import { Button } from "@/src/ui";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

export default function Login() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const { signInEmail, signUp, signInWithGoogle } = useAuth();
  const { show } = useToast();

  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password.trim() || (mode === "signup" && !name.trim())) {
      show("Please fill in all fields", "error");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const { reactivated } = await signInEmail(email.trim(), password);
        if (reactivated) show("Welcome back — your account has been reactivated", "success");
      } else await signUp(name.trim(), email.trim(), password);
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Authentication failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      show("Google sign-in failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing["3xl"], paddingBottom: insets.bottom + spacing.xl }]}
      bottomOffset={20}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.brandBlock}>
        <Text style={styles.logo}>THELOOKCRAFT</Text>
        <Text style={styles.tagline}>YOUR AI WARDROBE & PERSONAL STYLIST</Text>
      </View>

      {mode === "forgot" ? (
        <ForgotPassword initialEmail={email} inputStyle={styles.input} onBack={() => setMode("login")} />
      ) : (
      <View style={styles.form}>
        {mode === "signup" && (
          <TextInput
            testID="name-input"
            style={styles.input}
            placeholder="NAME"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}
        <TextInput
          testID="email-input"
          style={styles.input}
          placeholder="EMAIL"
          placeholderTextColor={colors.muted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          testID="password-input"
          style={styles.input}
          placeholder="PASSWORD"
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {mode === "login" && (
          <Pressable testID="forgot-password-link" onPress={() => setMode("forgot")} style={styles.forgot}>
            <Text style={styles.toggleText}>FORGOT PASSWORD?</Text>
          </Pressable>
        )}

        <Button
          testID="submit-button"
          title={mode === "login" ? "Sign In" : "Create Account"}
          onPress={submit}
          loading={busy}
          style={{ marginTop: spacing.sm }}
        />

        <View style={styles.dividerRow}>
          <View style={styles.line} />
          <Text style={styles.orText}>OR</Text>
          <View style={styles.line} />
        </View>

        <Button testID="google-button" title="Continue with Google" variant="outline" onPress={google} />

        <Pressable testID="toggle-mode" onPress={() => setMode(mode === "login" ? "signup" : "login")} style={styles.toggle}>
          <Text style={styles.toggleText}>
            {mode === "login" ? "NEW HERE?  CREATE AN ACCOUNT" : "ALREADY HAVE AN ACCOUNT?  SIGN IN"}
          </Text>
        </Pressable>
      </View>
      )}
    </KeyboardAwareScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flexGrow: 1, paddingHorizontal: spacing.lg, justifyContent: "center" },
  brandBlock: { marginBottom: spacing["3xl"], alignItems: "center" },
  logo: { fontSize: 26, fontWeight: "900", letterSpacing: 4, color: c.onSurface, textAlign: "center" },
  tagline: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 2, marginTop: spacing.sm, textAlign: "center" },
  form: { gap: spacing.md },
  input: {
    height: 54,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.lg,
    color: c.onSurface,
    fontSize: fontSize.base,
    letterSpacing: 1,
    backgroundColor: c.surfaceTertiary,
  },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.sm },
  line: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { color: c.muted, fontSize: fontSize.sm, letterSpacing: 2 },
  toggle: { alignItems: "center", paddingVertical: spacing.lg },
  forgot: { alignSelf: "flex-end", paddingVertical: spacing.sm, minHeight: 44, justifyContent: "center" },
  toggleText: { color: c.onSurface, fontSize: fontSize.sm, letterSpacing: 1, fontWeight: "600" },
}));
