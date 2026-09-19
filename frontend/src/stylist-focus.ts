import { useSyncExternalStore } from "react";

/**
 * Hand-off of a "style around this item" request from Item detail (a modal) to the Stylist tab.
 * Route params were unreliable here: the tab screen is already mounted and the push raced the
 * modal dismiss on iOS. A tiny external store avoids both problems.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

export function requestStylistFocus(itemId: string) {
  pending = itemId;
  listeners.forEach((l) => l());
}

export function consumeStylistFocus() {
  pending = null;
  listeners.forEach((l) => l());
}

export function usePendingStylistFocus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => pending,
  );
}
