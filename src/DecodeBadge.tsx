import { isTauri } from "@tauri-apps/api/core";
import { Binary, Clock, ExternalLink, KeyRound, Link2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { decodeValue, relativeTime, type Decoded } from "./decode";
import { isMac, modKey } from "./platform";

export async function openExternal(url: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

const fmt = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

function label(d: Decoded, now: Date) {
  switch (d.kind) {
    case "jwt": {
      if (!d.expiresAt) return { text: "JWT", tone: "" };
      const expired = d.expiresAt < now;
      return { text: `JWT · ${expired ? "expired" : "expires"} ${relativeTime(d.expiresAt, now)}`, tone: expired ? "bad" : "" };
    }
    case "time": return { text: relativeTime(d.date, now), tone: "" };
    case "base64": return { text: d.json !== undefined ? "base64 → JSON" : "base64 → text", tone: "" };
    case "color": return { text: "", tone: "" };
    case "url": return { text: "", tone: "" };
  }
}

const TIME_CLAIMS = new Set(["exp", "iat", "nbf", "auth_time"]);

function Details({ d, onNewRequest }: { d: Decoded; onNewRequest?: (url: string) => void }) {
  const now = new Date();
  switch (d.kind) {
    case "jwt":
      return (
        <>
          <h5>Payload</h5>
          <dl className="claims">
            {Object.entries(d.payload).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  <code>{typeof v === "string" ? v : JSON.stringify(v)}</code>
                  {TIME_CLAIMS.has(k) && typeof v === "number" && <span className="muted" title={fmt(new Date(v * 1000))}> · {relativeTime(new Date(v * 1000), now)}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <h5>Header</h5>
          <pre>{JSON.stringify(d.header, null, 2)}</pre>
          <p className="muted small">Decoded only. The signature is not verified.</p>
        </>
      );
    case "time":
      return (
        <dl className="claims">
          <div><dt>Local</dt><dd>{fmt(d.date)}</dd></div>
          <div><dt>UTC</dt><dd><code>{d.date.toISOString()}</code></dd></div>
          <div><dt>Relative</dt><dd>{relativeTime(d.date, now)}</dd></div>
          <div><dt>Unix</dt><dd><code>{Math.floor(d.date.getTime() / 1000)}</code></dd></div>
        </dl>
      );
    case "base64":
      return (
        <>
          <h5>Decoded {d.json !== undefined ? "JSON" : "text"}</h5>
          <pre>{d.json !== undefined ? JSON.stringify(d.json, null, 2) : d.text}</pre>
          <button className="ghost small" onClick={() => navigator.clipboard.writeText(d.json !== undefined ? JSON.stringify(d.json, null, 2) : d.text)}>Copy decoded</button>
        </>
      );
    case "color":
      return (
        <div className="color-detail">
          <span className="swatch big" style={{ background: d.css }} />
          <code>{d.css}</code>
        </div>
      );
    case "url":
      return (
        <div className="decode-actions">
          <code className="url-full">{d.url}</code>
          <button className="ghost small" onClick={() => openExternal(d.url)}><ExternalLink size={12} /> Open in browser</button>
          {onNewRequest && <button className="ghost small" onClick={() => onNewRequest(d.url)}><Plus size={12} /> New request</button>}
        </div>
      );
  }
}

const ICONS = { jwt: KeyRound, time: Clock, base64: Binary, url: Link2, color: null } as const;

/** A small badge after a value, opening a popover with its decoded meaning. */
export function DecodeBadge({ value, field = "", onNewRequest }: { value: unknown; field?: string; onNewRequest?: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ x: "left", y: "below" });
  const ref = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    if (!open && ref.current) {
      // Open toward the side with room inside the scrolling pane.
      const box = ref.current.getBoundingClientRect();
      const pane = (ref.current.closest(".payload") ?? document.body).getBoundingClientRect();
      setPlace({ x: pane.right - box.left < 360 ? "right" : "left", y: pane.bottom - box.bottom < 260 && box.top - pane.top > 260 ? "above" : "below" });
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  const d = decodeValue(value, field);
  if (!d) return null;
  const { text, tone } = label(d, new Date());
  const Icon = ICONS[d.kind];
  const title = d.kind === "time" ? fmt(d.date) : d.kind === "url" ? `Open or create a request (${isMac() ? "⌘" : "Ctrl"}-click opens in browser)` : "Show decoded value";

  return (
    <span className="decode" ref={ref}>
      <button
        className={`decode-badge ${d.kind} ${tone}`} title={title} aria-expanded={open} aria-label={`${d.kind} details`}
        onClick={(e) => {
          e.stopPropagation();
          if (d.kind === "url" && modKey(e)) openExternal(d.url);
          else toggle();
        }}
      >
        {d.kind === "color" ? <span className="swatch" style={{ background: d.css }} /> : Icon && <Icon size={11} />}
        {text && <span>{text}</span>}
      </button>
      {open && (
        <div className={`decode-pop ${place.x} ${place.y}`} role="dialog" aria-label="Decoded value" onClick={(e) => e.stopPropagation()}>
          <Details d={d} onNewRequest={onNewRequest && ((u) => { setOpen(false); onNewRequest(u); })} />
        </div>
      )}
    </span>
  );
}
