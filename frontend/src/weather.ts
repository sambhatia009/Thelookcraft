import { useCallback, useState } from "react";
import { Linking, Platform } from "react-native";
import * as Location from "expo-location";

export type Weather = { tempC: number; desc: string; label: string };

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

export function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);

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
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`,
      );
      const data = await res.json();
      const tempC = Math.round(data?.current?.temperature_2m ?? 0);
      const code = data?.current?.weather_code ?? 0;
      const desc = WMO[code] || "Clear";
      const w: Weather = { tempC, desc, label: `${tempC}°C · ${desc.toUpperCase()}` };
      setWeather(w);
      return w;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { weather, loading, blocked, enable };
}
