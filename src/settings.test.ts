import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, surfaceAlphas } from "./settings";

describe("surfaceAlphas", () => {
  it("is solid at zero and clamps out-of-range input", () => {
    expect(surfaceAlphas(0)).toEqual({ sidebar: 1, glass: 0.97, glassStrong: 0.99, solid: true });
    expect(surfaceAlphas(-5).solid).toBe(true);
    expect(surfaceAlphas(9)).toEqual(surfaceAlphas(1));
    expect(surfaceAlphas(Number.NaN).solid).toBe(false);
  });

  it("gets more see-through as transparency grows but never unreadable", () => {
    const low = surfaceAlphas(0.2);
    const high = surfaceAlphas(1);
    expect(high.sidebar).toBeLessThan(low.sidebar);
    expect(high.glass).toBeLessThan(low.glass);
    expect(high.sidebar).toBeGreaterThanOrEqual(0.38);
    expect(high.glassStrong).toBeGreaterThanOrEqual(0.6);
  });

  it("forces solid when macOS Reduce Transparency is on", () => {
    expect(surfaceAlphas(1, true)).toEqual(surfaceAlphas(0));
  });

  it("default matches the original look closely", () => {
    const a = surfaceAlphas(DEFAULT_SETTINGS.transparency);
    expect(a.sidebar).toBeGreaterThan(0.65);
    expect(a.sidebar).toBeLessThan(0.78);
  });
});
