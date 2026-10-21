import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type Settings = {
  /** 0 = solid, 1 = most see-through. */
  transparency: number;
};

export const DEFAULT_SETTINGS: Settings = { transparency: 0.45 };
const KEY = "tether.settings.v1";

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : DEFAULT_SETTINGS.transparency));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (n: number) => Math.round(n * 1000) / 1000;

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return { transparency: clamp(typeof raw.transparency === "number" ? raw.transparency : DEFAULT_SETTINGS.transparency) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/**
 * Surface opacities for a transparency level. Even at the maximum the surfaces keep enough
 * body to stay legible over a busy desktop. macOS "Reduce Transparency" always forces solid.
 */
export function surfaceAlphas(transparency: number, reduced = false) {
  const t = reduced ? 0 : clamp(transparency);
  return {
    sidebar: round(lerp(1, 0.38, t)),
    glass: round(lerp(0.97, 0.38, t)),
    glassStrong: round(lerp(0.99, 0.6, t)),
    solid: t === 0,
  };
}

export const prefersReducedTransparency = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-transparency: reduce)").matches;

export async function applyAppearance(settings: Settings) {
  const reduced = prefersReducedTransparency();
  const a = surfaceAlphas(settings.transparency, reduced);
  const root = document.documentElement;
  root.style.setProperty("--sidebar-a", String(a.sidebar));
  root.style.setProperty("--glass-a", String(a.glass));
  root.style.setProperty("--glass-strong-a", String(a.glassStrong));
  root.classList.toggle("solid", a.solid);
  if (!isTauri()) return;
  // A solid window needs no native material behind it; this also saves GPU work.
  try {
    const { getCurrentWindow, Effect, EffectState } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setEffects({ effects: a.solid ? [] : [Effect.UnderWindowBackground], state: EffectState.FollowsWindowActiveState });
  } catch {
    /* Window effects are macOS and Windows only. */
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [reduced, setReduced] = useState(prefersReducedTransparency);

  useEffect(() => {
    applyAppearance(settings);
    saveSettings(settings);
  }, [settings, reduced]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return { settings, update: (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch, transparency: clamp(patch.transparency ?? s.transparency) })), reduced };
}
