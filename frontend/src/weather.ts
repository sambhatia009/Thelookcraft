import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import * as Location from "expo-location";

import { storage } from "@/src/utils/storage";

export type Weather = { tempC: number; desc: string; label: string; updatedAt: number };

const ENABLED_KEY = "sv_weather_enabled";
const REFRESH_MS = 15 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  80: "Showers",
  81: "Showers",
  82: "Heavy Showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

async function fetchWeather(): Promise<Weather> {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
  const { latitude, longitude } = pos.coords;
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`,
  );
  const data = await res.json();
  const tempC = Math.round(data?.current?.temperature_2m ?? 0);
  const code = data?.current?.weather_code ?? 0;
  const desc = WMO[code] || "Clear";
  return { tempC, desc, label: `${tempC}°C · ${desc.toUpperCase()}`, updatedAt: Date.now() };
}

/**
 * Weather context for the stylist.
 * - `enable()` asks for location permission (contextual, user-initiated) and remembers the choice.
 * - Once enabled, weather auto-refreshes: on mount, every 15 min, and whenever the app returns to foreground.
 *   Background refreshes never prompt for permission — they only run if it is already granted.
 */
export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const inflight = useRef(false);

  const refresh = useCallback(async (): Promise<Weather | null> => {
    if (inflight.current) return null;
    inflight.current = true;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return null;
      const w = await fetchWeather();
      setWeather(w);
      return w;
    } catch {
      return null;
    } finally {
      inflight.current = false;
    }
  }, []);

  const enable = useCallback(async (): Promise<Weather | null> => {
    setLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          setBlocked(true);
          if (Platform.OS !== "web") Linking.openSettings();
        }
        return null;
      }
      setBlocked(false);
      const w = await fetchWeather();
      setWeather(w);
      setEnabled(true);
      storage.setItem(ENABLED_KEY, true);
      return w;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setEnabled(false);
    setWeather(null);
    await storage.removeItem(ENABLED_KEY);
  }, []);

  // Restore preference and do an initial silent refresh.
  useEffect(() => {
    let alive = true;
    (async () => {
      const on = await storage.getItem<boolean>(ENABLED_KEY, false);
      if (!alive || !on) return;
      setEnabled(true);
      setLoading(true);
      await refresh();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // Periodic + foreground refresh while enabled.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(refresh, REFRESH_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setWeather((w) => {
          if (!w || Date.now() - w.updatedAt > STALE_MS) refresh();
          return w;
        });
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, refresh]);

  return { weather, loading, blocked, enabled, enable, disable, refresh };
}
