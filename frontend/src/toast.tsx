import React, { createContext, useCallback, useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

type ToastKind = "default" | "success" | "error";
type ToastAction = { label: string; onPress: () => void };
type Toast = { id: number; message: string; kind: ToastKind; action?: ToastAction };

const ToastContext = createContext<{ show: (m: string, k?: ToastKind, action?: ToastAction) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();

  const show = useCallback((message: string, kind: ToastKind = "default", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 5000 : 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <View style={[styles.wrap, { bottom: insets.bottom + spacing["3xl"], pointerEvents: "box-none" }]}>
        {toasts.map((t) => {
          const fg = t.kind === "default" ? colors.onSurfaceInverse : "#ffffff";
          return (
            <Animated.View
              key={t.id}
              entering={FadeInDown}
              exiting={FadeOutDown}
              style={[
                styles.toast,
                {
                  pointerEvents: t.action ? "auto" : "none",
                  backgroundColor:
                    t.kind === "error" ? colors.error : t.kind === "success" ? colors.success : colors.surfaceInverse,
                },
              ]}
              testID="toast"
            >
              <Text style={[styles.text, { color: fg, flex: 1 }]}>{t.message}</Text>
              {t.action && (
                <Pressable
                  onPress={() => {
                    setToasts((all) => all.filter((x) => x.id !== t.id));
                    t.action?.onPress();
                  }}
                  hitSlop={8}
                  testID="toast-action"
                >
                  <Text style={[styles.action, { color: fg }]}>{t.action.label.toUpperCase()}</Text>
                </Pressable>
              )}
            </Animated.View>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, gap: spacing.sm, alignItems: "center" },
  toast: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, width: "100%", flexDirection: "row", alignItems: "center", gap: spacing.md },
  text: { fontSize: fontSize.base, fontWeight: "600", letterSpacing: 0.3 },
  action: { fontSize: fontSize.sm, fontWeight: "900", letterSpacing: 1, textDecorationLine: "underline" },
}));
