// Native (Liquid Glass) tabs are disabled: on iOS 26 the unstable NativeTabs API reports
// device-only safe-area insets, so bottom-anchored UI (Stylist composer, Closet FAB) rendered
// hidden behind the tab bar. The JS tab bar reserves its own space on every platform.
export const usesNativeTabs = false;
