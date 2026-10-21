import { useEffect, useRef, useState } from "react";

/**
 * A tiny pixel game for the empty workspace: fly the rocket, shoot or dodge the barriers.
 * Space / click to launch and fire, ↑ ↓ (or W S, or the mouse) to steer.
 */

const H = 168;
const P = 4; // one art pixel
const ROCKET = [
  "..ff........",
  "..ffoooo....",
  "fooowwoooo..",
  "fooowwooooo.",
  "fooooooooo..",
  "..ffoooo....",
  "..ff........",
];
const RW = ROCKET[0].length * P;
const RH = ROCKET.length * P;
const RX = 40;
const HI_KEY = "tether.rocket.hi";

type Barrier = { x: number; y: number; w: number; h: number; hp: number; max: number; flash: number };
type Bullet = { x: number; y: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Phase = "idle" | "running" | "over" | "paused";

type Palette = { accent: string; fold: string; window: string; flame: string; flame2: string; brick: string; brickHi: string; hit: string; ink: string; faint: string };

function readPalette(el: HTMLElement): Palette {
  const probe = document.createElement("span");
  el.appendChild(probe);
  const get = (v: string) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
  const accent = get("--accent");
  const p: Palette = {
    accent,
    fold: darken(accent, 0.4),
    window: get("--canvas"),
    flame: get("--orange"),
    flame2: "rgb(255 214 10)",
    brick: get("--ink-3"),
    brickHi: get("--ink-2"),
    hit: get("--red"),
    ink: get("--ink-2"),
    faint: get("--ink-4"),
  };
  probe.remove();
  return p;
}

function darken(rgb: string, by: number) {
  const n = rgb.match(/[\d.]+/g)?.map(Number) ?? [10, 132, 255];
  return `rgb(${Math.round(n[0] * (1 - by))} ${Math.round(n[1] * (1 - by))} ${Math.round(n[2] * (1 - by))})`;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const snap = (v: number) => Math.round(v / P) * P;

export function RocketGame() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [hi, setHi] = useState(() => Number(localStorage.getItem(HI_KEY)) || 0);

  useEffect(() => {
    const cv = canvas.current!;
    const box = wrap.current!;
    const ctx = cv.getContext("2d")!;
    let W = 520;
    let pal = readPalette(box);
    let shown = 0;

    const s = {
      phase: "idle" as Phase,
      y: H / 2 - RH / 2,
      vy: 0,
      target: null as number | null,
      up: false,
      down: false,
      barriers: [] as Barrier[],
      bullets: [] as Bullet[],
      sparks: [] as Spark[],
      t: 0,
      speed: 150,
      spawnIn: 1,
      cooldown: 0,
      score: 0,
      kills: 0,
      shake: 0,
    };

    const resize = () => {
      W = Math.max(280, Math.min(560, box.clientWidth));
      const dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { pal = readPalette(box); };
    scheme.addEventListener("change", onScheme);

    const setP = (p: Phase) => { s.phase = p; setPhase(p); };

    const reset = () => {
      Object.assign(s, { y: H / 2 - RH / 2, vy: 0, barriers: [], bullets: [], sparks: [], t: 0, speed: 150, spawnIn: 0.8, cooldown: 0, score: 0, kills: 0, shake: 0 });
      shown = 0;
      setScore(0);
    };

    const burst = (x: number, y: number, n: number, colors: string[]) => {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(40, 170);
        s.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.35, 0.8), color: colors[i % colors.length] });
      }
    };

    const spawn = () => {
      const kind = Math.random();
      const w = P * (Math.random() < 0.5 ? 5 : 7);
      let b: Barrier;
      if (kind < 0.38) {
        const h = snap(rand(H * 0.35, H * 0.62));
        b = { x: W + 4, y: H - h, w, h, hp: 3, max: 3, flash: 0 };
      } else if (kind < 0.76) {
        const h = snap(rand(H * 0.35, H * 0.62));
        b = { x: W + 4, y: 0, w, h, hp: 3, max: 3, flash: 0 };
      } else {
        const h = snap(rand(28, 48));
        b = { x: W + 4, y: snap(rand(12, H - h - 12)), w: P * 6, h, hp: 1, max: 1, flash: 0 };
      }
      s.barriers.push(b);
      s.spawnIn = rand(0.95, 1.6) * Math.max(0.55, 1 - s.t / 90);
    };

    const fire = () => {
      if (s.cooldown > 0) return;
      s.bullets.push({ x: RX + RW, y: s.y + RH / 2 - 1 });
      s.cooldown = 0.2;
    };

    const crash = () => {
      burst(RX + RW / 2, s.y + RH / 2, 34, [pal.flame, pal.flame2, pal.accent, pal.hit]);
      s.shake = 0.35;
      const final = Math.floor(s.score);
      setScore(final);
      setHi((h) => {
        const n = Math.max(h, final);
        localStorage.setItem(HI_KEY, String(n));
        return n;
      });
      setP("over");
    };

    const hits = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const update = (dt: number) => {
      s.cooldown = Math.max(0, s.cooldown - dt);
      s.shake = Math.max(0, s.shake - dt);
      for (const p of s.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt; }
      s.sparks = s.sparks.filter((p) => p.life > 0);
      if (s.phase !== "running") return;

      s.t += dt;
      s.speed = Math.min(360, 150 + s.t * 5);
      s.score += dt * 10;

      const accel = 900;
      if (s.target !== null && !s.up && !s.down) {
        const d = s.target - (s.y + RH / 2);
        s.vy = Math.max(-200, Math.min(200, d * 8));
      } else {
        s.vy += ((s.down ? 1 : 0) - (s.up ? 1 : 0)) * accel * dt;
        if (!s.up && !s.down) s.vy *= Math.pow(0.02, dt);
        s.vy = Math.max(-200, Math.min(200, s.vy));
      }
      s.y = Math.max(2, Math.min(H - RH - 2, s.y + s.vy * dt));

      s.spawnIn -= dt;
      if (s.spawnIn <= 0) spawn();

      for (const b of s.barriers) { b.x -= s.speed * dt; b.flash = Math.max(0, b.flash - dt); }
      for (const u of s.bullets) u.x += 420 * dt;

      for (const u of s.bullets) {
        const ub = { x: u.x, y: u.y, w: P * 2, h: P };
        for (const b of s.barriers) {
          if (b.hp > 0 && hits(ub, b)) {
            u.x = Infinity;
            b.hp -= 1;
            b.flash = 0.12;
            burst(b.x, ub.y, 5, [pal.brickHi, pal.flame]);
            if (b.hp === 0) {
              burst(b.x + b.w / 2, b.y + b.h / 2, 22, [pal.brick, pal.brickHi, pal.flame]);
              s.score += 25;
              s.kills += 1;
            }
            break;
          }
        }
      }
      s.bullets = s.bullets.filter((u) => u.x < W + 10);
      s.barriers = s.barriers.filter((b) => b.x + b.w > -10 && b.hp > 0);

      const body = { x: RX + P, y: s.y + P, w: RW - P * 3, h: RH - P * 2 };
      if (s.barriers.some((b) => hits(body, b))) crash();
      else if (Math.floor(s.score) !== shown) { shown = Math.floor(s.score); setScore(shown); }
    };

    const drawRocket = (y: number, flameOn: boolean) => {
      ROCKET.forEach((row, r) => {
        [...row].forEach((c, i) => {
          if (c === ".") return;
          ctx.fillStyle = c === "o" ? pal.accent : c === "f" ? pal.fold : pal.window;
          ctx.fillRect(RX + i * P, y + r * P, P, P);
        });
      });
      if (flameOn) {
        const len = 2 + Math.floor(Math.random() * 3);
        for (let i = 1; i <= len; i++) {
          ctx.fillStyle = i === 1 ? pal.flame2 : pal.flame;
          ctx.fillRect(RX - i * P, y + 2 * P, P, P * 3);
        }
      }
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (s.shake > 0) ctx.translate(snap(rand(-3, 3)), snap(rand(-3, 3)));

      // Ground and ceiling: dotted pixel rails.
      ctx.fillStyle = pal.faint;
      const off = Math.floor((s.t * s.speed) % (P * 4));
      for (let x = -off; x < W; x += P * 4) { ctx.fillRect(x, H - P, P * 2, P); ctx.fillRect(x, 0, P * 2, P); }

      for (const b of s.barriers) {
        ctx.fillStyle = b.flash > 0 ? pal.hit : b.hp < b.max ? pal.brickHi : pal.brick;
        ctx.globalAlpha = b.hp / b.max * 0.5 + 0.5;
        for (let yy = b.y; yy < b.y + b.h; yy += P * 3) {
          const shift = ((yy - b.y) / (P * 3)) % 2 ? P * 2 : 0;
          for (let xx = b.x - shift; xx < b.x + b.w; xx += P * 4) {
            const x0 = Math.max(b.x, xx);
            const x1 = Math.min(b.x + b.w, xx + P * 4 - 1);
            ctx.fillRect(x0, yy, x1 - x0, Math.min(P * 3 - 1, b.y + b.h - yy));
          }
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = pal.flame2;
      for (const u of s.bullets) ctx.fillRect(u.x, u.y, P * 2, P);

      if (s.phase !== "over") {
        const bob = s.phase === "idle" ? (Math.floor(time / 400) % 2) * P : 0;
        drawRocket(Math.round(s.y / P) * P + bob, s.phase === "running" || Math.floor(time / 120) % 2 === 0);
      }
      for (const p of s.sparks) {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(snap(p.x), snap(p.y), P, P);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const start = () => { reset(); setP("running"); };
    const primary = () => {
      if (s.phase === "running") fire();
      else if (s.phase === "paused") setP("running");
      else start();
    };

    // Only take keys when nothing else wants them (no field or button is focused).
    const free = () => {
      const a = document.activeElement;
      return !a || a === document.body || a === box;
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !free()) return;
      const k = e.key;
      if (k === " " || k === "Spacebar") { e.preventDefault(); if (down && !e.repeat) primary(); }
      else if (k === "ArrowUp" || k === "w" || k === "W") { e.preventDefault(); s.up = down; s.target = null; if (down && s.phase === "idle") start(); }
      else if (k === "ArrowDown" || k === "s" || k === "S") { e.preventDefault(); s.down = down; s.target = null; if (down && s.phase === "idle") start(); }
      else if (k === "Escape" && down && s.phase === "running") setP("paused");
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const onMove = (e: PointerEvent) => {
      if (s.phase !== "running") return;
      const r = cv.getBoundingClientRect();
      s.target = e.clientY - r.top;
    };
    const onLeave = () => { s.target = null; };
    const onDown = (e: PointerEvent) => { e.preventDefault(); box.focus({ preventScroll: true }); primary(); };
    const onBlur = () => { s.up = s.down = false; if (s.phase === "running") setP("paused"); };

    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", onBlur);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scheme.removeEventListener("change", onScheme);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", onBlur);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const pad = (n: number) => String(n).padStart(5, "0");
  return (
    <div className="rocket-game" ref={wrap} tabIndex={-1}>
      <div className="rg-hud" aria-live="polite">
        {hi > 0 && <span className="rg-hi">HI {pad(hi)}</span>}
        <span>{pad(score)}</span>
      </div>
      <canvas ref={canvas} role="img" aria-label="Rocket game. Press Space to launch and fire, arrow keys to steer." />
      <p className="rg-hint">
        {phase === "idle" && <><kbd>Space</kbd> to launch and fire · <kbd>↑</kbd><kbd>↓</kbd> to steer</>}
        {phase === "running" && <><kbd>Space</kbd> fire · <kbd>↑</kbd><kbd>↓</kbd> steer · <kbd>esc</kbd> pause</>}
        {phase === "paused" && <>Paused · <kbd>Space</kbd> to resume</>}
        {phase === "over" && <>Crashed with {score.toLocaleString()} points · <kbd>Space</kbd> to fly again</>}
      </p>
    </div>
  );
}
