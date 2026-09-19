import React, { createContext, useCallback, useContext, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

type ToastKind = "default" | "success" | "error";
type Toast = { id: number; message: string; kind: ToastKind };

const ToastContext = createContext<{ show: (m: string, k?: ToastKind) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();

  const show = useCallback((message: string, kind: ToastKind = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <View style={[styles.wrap, { bottom: insets.bottom + spacing["3xl"], pointerEvents: "box-none" }]}>
        {toasts.map((t) => (
          <Animated.View
            key={t.id}
            entering={FadeInDown}
            exiting={FadeOutDown}
            style={[
              styles.toast,
              {
                pointerEvents: "none",
                backgroundColor:
                  t.kind === "error" ? colors.error : t.kind === "success" ? colors.success : colors.surfaceInverse,
              },
            ]}
            testID="toast"
          >
            <Text
              style={[
                styles.text,
                { color: t.kind === "default" ? colors.onSurfaceInverse : "#ffffff" },
              ]}
            >
              {t.message}
            </Text>
          </Animated.View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, gap: spacing.sm, alignItems: "center" },
  toast: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, width: "100%" },
  text: { fontSize: fontSize.base, fontWeight: "600", letterSpacing: 0.3 },
}));
