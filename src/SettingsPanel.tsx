import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

export function SettingsPanel({ settings, update, reduced, onClose }: {
  settings: Settings; update: (patch: Partial<Settings>) => void; reduced: boolean; onClose: () => void;
}) {
  const pct = Math.round(settings.transparency * 100);
  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal settings" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="agent-body">
          <header>
            <SlidersHorizontal size={20} aria-hidden />
            <div>
              <h2>Settings</h2>
              <p className="muted">Changes apply immediately.</p>
            </div>
          </header>

          <section>
            <h3>Appearance</h3>
            <div className="agent-row setting-row">
              <div className="setting-label">
                <label htmlFor="transparency"><strong>Transparency</strong></label>
                <p className="muted small">
                  How see-through the sidebar, toolbar controls and menus are. At 0% the window is fully solid.
                </p>
              </div>
              <output className="setting-value" htmlFor="transparency">{reduced ? "Off" : `${pct}%`}</output>
            </div>
            <div className="slider-row">
              <span className="muted small">Solid</span>
              <input
                id="transparency" type="range" min={0} max={100} step={1} value={pct} disabled={reduced}
                aria-valuetext={`${pct} percent`} style={{ ["--fill-pct" as string]: `${pct}%` }}
                onChange={(e) => update({ transparency: Number(e.target.value) / 100 })}
              />
              <span className="muted small">Clear</span>
            </div>
            {reduced && (
              <p className="note">macOS “Reduce transparency” is on (System Settings → Accessibility → Display), so Tether stays solid.</p>
            )}
            <button className="ghost small" onClick={() => update({ transparency: DEFAULT_SETTINGS.transparency })} disabled={reduced || settings.transparency === DEFAULT_SETTINGS.transparency}>
              <RotateCcw size={12} /> Reset to default
            </button>
          </section>
        </div>
        <footer className="modal-foot"><button className="primary" onClick={onClose}>Done</button></footer>
      </div>
    </div>
  );
}
