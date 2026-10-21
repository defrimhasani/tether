import { isTauri } from "@tauri-apps/api/core";

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** ⌘ on macOS, Ctrl elsewhere. */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac() ? e.metaKey : e.ctrlKey);

/**
 * Only macOS puts a native material behind the transparent desktop window. On Windows and
 * Linux it would show raw desktop pixels, so the window is always drawn solid there.
 */
export const vibrancyUnavailable = () => isTauri() && !isMac();
