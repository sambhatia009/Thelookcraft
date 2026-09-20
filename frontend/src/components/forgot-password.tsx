import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { api, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useToast } from "@/src/toast";
import { Button } from "@/src/ui";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

type Props = { initialEmail: string; inputStyle: object; onBack: () => void };

/** Two steps: request a 6-digit code by email, then choose a new password (signs the user in). */
export function ForgotPassword({ initialEmail, inputStyle, onBack }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { show } = useToast();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"request" | "reset">("request");
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (!email.trim()) return show("Enter your email first", "error");
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim());
      show(res.message || "Check your email for the code", "success");
      setStep("reset");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Could not send the code. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (code.trim().length !== 6) return show("Enter the 6-digit code from your email", "error");
    if (password.length < 6) return show("Password must be at least 6 characters", "error");
    setBusy(true);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      show("Password updated — you're signed in", "success");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Could not reset the password", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form} testID="forgot-password">
      <Text style={styles.title}>{step === "request" ? "RESET PASSWORD" : "ENTER YOUR CODE"}</Text>
      <Text style={styles.hint}>
        {step === "request"
          ? "We'll email you a 6-digit code to choose a new password."
          : `Code sent to ${email.trim()}. It expires in 15 minutes.`}
      </Text>
      <TextInput
        testID="forgot-email-input"
        style={inputStyle}
        placeholder="EMAIL"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={step === "request"}
      />
      {step === "reset" && (
        <>
          <TextInput
            testID="reset-code-input"
            style={inputStyle}
            placeholder="6-DIGIT CODE"
            placeholderTextColor={colors.muted}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
          <TextInput
            testID="new-password-input"
            style={inputStyle}
            placeholder="NEW PASSWORD"
            placeholderTextColor={colors.muted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </>
      )}
      <Button
        testID="forgot-submit"
        title={step === "request" ? "Send Code" : "Set New Password"}
        onPress={step === "request" ? request : reset}
        loading={busy}
        style={{ marginTop: spacing.sm }}
      />
      {step === "reset" && (
        <Pressable testID="resend-code" onPress={request} disabled={busy} style={styles.link}>
          <Text style={styles.linkText}>DIDN'T GET IT?  SEND AGAIN</Text>
        </Pressable>
      )}
      <Pressable testID="back-to-login" onPress={onBack} style={styles.link}>
        <Text style={styles.linkText}>BACK TO SIGN IN</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  form: { gap: spacing.md },
  title: { fontSize: fontSize.sm, letterSpacing: 2, fontWeight: "700", color: c.onSurface },
  hint: { fontSize: fontSize.sm, color: c.muted, lineHeight: 20 },
  link: { alignItems: "center", paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  linkText: { color: c.onSurface, fontSize: fontSize.sm, letterSpacing: 1, fontWeight: "600" },
}));
