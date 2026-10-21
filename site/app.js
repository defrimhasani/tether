(() => {
  const RELEASES = "https://github.com/defrimhasani/tether/releases";
  const asset = (name) => `${RELEASES}/latest/download/${name}`;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1);
  const os = /Win/i.test(platform) || /Windows/.test(ua) ? "win" : /Linux|X11/i.test(platform) && !/Android/.test(ua) ? "linux" : "mac";
  const isMac = /Mac|iPhone|iPad/.test(platform) || /Mac OS X/.test(ua);

  // Shortcut labels follow the visitor's platform.
  if (!isMac) document.querySelectorAll("[data-mod]").forEach((k) => (k.textContent = k.textContent.replace("⌘", "Ctrl+")));

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const status = $("[data-status]");

  /* ——— Installers ——— */
  const installers = {
    mac: { name: "macOS", file: "Tether-macOS-universal.dmg", sub: "Universal · Apple Silicon and Intel · .dmg", icon: "b-apple" },
    win: { name: "Windows", file: "Tether-Windows-x64-setup.exe", sub: "x64 · .exe installer", icon: "b-windows" },
    linux: { name: "Linux", file: "Tether-Linux-x86_64.AppImage", sub: "x86_64 · AppImage", icon: "b-linux" },
  };
  $$("[data-asset]").forEach((a) => { a.href = asset(a.dataset.asset); a.setAttribute("download", ""); });
  const detectedRow = $(`.inst[data-os="${os}"]`);
  if (detectedRow && !mobile) {
    detectedRow.dataset.detected = "";
    detectedRow.parentElement.prepend(detectedRow);
    const small = $("small", detectedRow);
    small.insertAdjacentHTML("afterbegin", `<span class="tag">Recommended</span> · `);
  }
  const notes = $("[data-notes]");
  const note = $(`.note[data-os="${os}"]`);
  if (note) note.parentElement.insertBefore(note, $(".note", notes));

  const defaultStatus = () => {
    status.innerHTML = mobile
      ? `Tether is a desktop app for macOS, Windows and Linux. <a href="#download">See downloads</a>`
      : `Version 0.1.0 · also for ${Object.keys(installers).filter((k) => k !== os).map((k) => installers[k].name).join(" and ")}. <a href="#download">All downloads</a>`;
  };
  defaultStatus();

  const download = (key) => {
    const it = installers[key];
    location.href = asset(it.file);
    status.innerHTML = `Downloading Tether for ${it.name}. ${key === "mac" ? "Unsigned build: right-click Tether and choose Open the first time." : key === "win" ? "If SmartScreen appears, choose More info, then Run anyway." : "Make the AppImage executable, then run it."} <a href="#download" data-open-notes>Install notes</a>`;
  };
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-notes]")) notes.open = true;
    const dl = e.target.closest(".dl");
    if (dl) {
      notes.open = true;
      const n = $(`.note[data-os="${dl.closest(".inst").dataset.os}"]`, notes);
      $$(".note", notes).forEach((x) => x.toggleAttribute("data-on", x === n));
      n.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    }
  });
  if (mobile) {
    document.documentElement.classList.add("touch");
    $("[data-keys-copy]").textContent = "Send, cancel, save and jump anywhere without reaching for the mouse. On a keyboard, every action in the Request menu is one press away.";
  }

  /* ——— Command palette ——— */
  const go = (hash, after) => () => {
    const el = $(hash);
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", hash);
    if (after) after();
  };
  const order = [os, ...Object.keys(installers).filter((k) => k !== os)];
  const commands = [
    ...order.map((k, i) => ({
      group: "Download", title: `Download for ${installers[k].name}`, sub: installers[k].sub, icon: installers[k].icon, brand: true,
      keys: `download install get ${installers[k].name} ${k === "mac" ? "apple mac osx dmg" : k === "win" ? "pc exe msi" : "appimage deb ubuntu"}`,
      tag: i === 0 && !mobile ? "This computer" : "", run: () => download(k),
    })),
    { group: "Explore", title: "Chain requests with references", sub: "<code>{{@create_session.body.json.token}}</code>", icon: "i-link", keys: "chain chaining reference variable token reuse", run: go("#chain", () => demo.play(0)) },
    { group: "Explore", title: "Keep your workspace as files", sub: "Git-friendly JSON, secrets in the keychain", icon: "i-folder", keys: "files git folder local json commit keychain secrets", run: go("#files") },
    { group: "Explore", title: "Keyboard shortcuts", sub: "Send, cancel, save, environments", icon: "i-command", keys: "keyboard shortcuts keys hotkeys", run: go("#keys") },
    { group: "Explore", title: "Let agents run requests safely", sub: "MCP for Claude, Cursor and OpenCode", icon: "i-bot", keys: "agents ai mcp claude cursor opencode llm", run: go("#agents") },
    { group: "Explore", title: "Install notes", sub: "First launch on each system", icon: "i-terminal", keys: "install notes gatekeeper smartscreen unsigned help", run: go("#download", () => (notes.open = true)) },
    { group: "Explore", title: "View source on GitHub", sub: "github.com/defrimhasani/tether", icon: "i-github", keys: "github source code repo", run: () => (location.href = "https://github.com/defrimhasani/tether") },
  ];

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (text, q) => {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  };

  function palette(root, { onRun } = {}) {
    const input = $("input", root);
    const list = $(".pal-list", root);
    let shown = [];
    let active = 0;
    const id = list.id;

    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = commands.filter((c) => !q || `${c.title} ${c.keys}`.toLowerCase().includes(q));
      active = Math.min(active, Math.max(0, shown.length - 1));
      if (!shown.length) {
        list.innerHTML = `<p class="pal-empty">No commands match <b>“${esc(input.value.trim())}”</b>. Try “download” or “chain”.</p>`;
        input.removeAttribute("aria-activedescendant");
        return;
      }
      let html = "";
      let group = "";
      shown.forEach((c, i) => {
        if (c.group !== group) { group = c.group; html += `<p class="pal-group" role="presentation">${group}</p>`; }
        html += `<div class="pal-row" role="option" id="${id}-${i}" data-i="${i}" aria-selected="${i === active}">
          <span class="pal-ico"><svg class="${c.brand ? "b" : "i"}"><use href="#${c.icon}"/></svg></span>
          <span><span class="pal-t">${mark(c.title, q)}</span><span class="pal-s">${c.sub.startsWith("<code>") ? c.sub : esc(c.sub)}</span></span>
          <span class="pal-hint">${c.tag ? `<span class="tag">${c.tag}</span>` : ""}<kbd class="ret">↵</kbd></span>
        </div>`;
      });
      list.innerHTML = html;
      input.setAttribute("aria-activedescendant", `${id}-${active}`);
    };
    const select = (i, scroll) => {
      active = (i + shown.length) % shown.length;
      $$(".pal-row", list).forEach((r) => r.setAttribute("aria-selected", String(+r.dataset.i === active)));
      input.setAttribute("aria-activedescendant", `${id}-${active}`);
      if (scroll) $(`#${id}-${active}`)?.scrollIntoView({ block: "nearest" });
    };
    const run = (i) => { const c = shown[i]; if (!c) return; if (onRun) onRun(); c.run(); };

    const fade = () => list.toggleAttribute("data-more", list.scrollTop + list.clientHeight < list.scrollHeight - 4);
    list.addEventListener("scroll", fade, { passive: true });
    input.addEventListener("input", () => { active = 0; render(); fade(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) { e.preventDefault(); select(active + 1, true); }
      else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) { e.preventDefault(); select(active - 1, true); }
      else if (e.key === "Enter") { e.preventDefault(); run(active); }
      else if (e.key === "Escape" && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ""; active = 0; render(); }
    });
    list.addEventListener("mousemove", (e) => { const r = e.target.closest(".pal-row"); if (r && +r.dataset.i !== active) select(+r.dataset.i); });
    list.addEventListener("click", (e) => { const r = e.target.closest(".pal-row"); if (r) run(+r.dataset.i); });
    render();
    requestAnimationFrame(fade);
    return { input, reset: () => { input.value = ""; active = 0; render(); } };
  }

  const hero = palette($('[data-palette="hero"]'));
  const dialog = $("[data-dialog]");
  const floating = palette($('[data-palette="dialog"]'), { onRun: () => dialog.close() });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const heroVisible = () => {
    const r = $('[data-palette="hero"]').getBoundingClientRect();
    return r.top > 40 && r.bottom < innerHeight;
  };
  const openPalette = () => {
    if (heroVisible()) { hero.input.focus(); hero.input.select(); return; }
    floating.reset();
    dialog.showModal();
    floating.input.focus();
  };
  $$("[data-open-palette]").forEach((b) => b.addEventListener("click", openPalette));
  if (matchMedia("(pointer: fine)").matches && !location.hash) hero.input.focus({ preventScroll: true });

  /* ——— Global shortcuts; the Shortcuts menu answers when it is on screen ——— */
  const menu = $("[data-menu]");
  let menuInView = false;
  new IntersectionObserver(([e]) => (menuInView = e.isIntersecting), { threshold: 0.4 }).observe(menu);
  const flash = (key) => {
    const li = $(`li[data-key="${CSS.escape(key)}"]`, menu);
    if (!li) return false;
    li.classList.remove("hit");
    void li.offsetWidth;
    li.classList.add("hit");
    setTimeout(() => li.classList.remove("hit"), 260);
    return true;
  };
  document.addEventListener("keydown", (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (menuInView) flash("k");
      if (dialog.open) dialog.close(); else openPalette();
      return;
    }
    if (!mod && e.key === "/" && !typing && !dialog.open) { e.preventDefault(); openPalette(); return; }
    if (mod && menuInView && !dialog.open) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (["Enter", ".", "s", "e", ",", "n"].includes(key) && flash(key)) e.preventDefault();
    }
  });

  /* ——— Top bar ——— */
  const bar = $("[data-bar]");
  const onScroll = () => bar.toggleAttribute("data-scrolled", scrollY > innerHeight * 0.55);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ——— Chaining demo ——— */
  const P = (s) => `<span class="j-p">${s}</span>`;
  const K = (k) => `<span class="j-key">"${k}"</span>`;
  const S = (v) => `<span class="j-str">"${v}"</span>`;
  const lines = (rows) => rows.map(([html, cls]) => `<span class="ln${cls ? ` ${cls}` : ""}">${html}</span>`).join("");
  const loginBody = (sel) => lines([
    [P("{")],
    [`  ${K("json")}${P(":")} ${P("{")}`],
    [`    ${K("token")}${P(":")} ${S("example-token-0000")}${P(",")}`, sel && "sel"],
    [`    ${K("user")}${P(":")} ${S("demo-user")}`],
    [`  ${P("},")}`],
    [`  ${K("origin")}${P(":")} ${S("203.0.113.24")}${P(",")}`],
    [`  ${K("url")}${P(":")} ${S("https://httpbin.org/post")}`],
    [P("}")],
  ]);
  const profileBody = lines([
    [P("{")],
    [`  ${K("args")}${P(":")} ${P("{")}`],
    [`    ${K("user")}${P(":")} ${S("demo-user")}`, "got"],
    [`  ${P("},")}`],
    [`  ${K("headers")}${P(":")} ${P("{")}`],
    [`    ${K("Authorization")}${P(":")} ${S("Bearer example-token-0000")}${P(",")}`, "got"],
    [`    ${K("Host")}${P(":")} ${S("httpbin.org")}${P(",")}`],
    [`    ${K("User-Agent")}${P(":")} ${S("Tether/0.1")}`],
    [`  ${P("},")}`],
    [`  ${K("url")}${P(":")} ${S("https://httpbin.org/get?user=demo-user")}`],
    [P("}")],
  ]);
  const V = `<span class="t-var">{{base_url}}</span>`;
  const R = (p) => `<span class="t-ref">{{@create_session.body.json.${p}}}</span>`;
  const loginReq = `<div class="kv"><span>Content-Type</span><span>application/json</span></div>
<pre class="w-code">${P("{")}
  ${K("user")}${P(":")} ${S("demo-user")}${P(",")}
  ${K("token")}${P(":")} ${S("example-token-0000")}
${P("}")}</pre>`;
  const profileReq = `<div class="kv"><span>Authorization</span><span>Bearer ${R("token")}</span></div>`;

  const states = [
    { req: "login", title: "Create session", method: "POST", url: `${V}/post`, pane: loginReq, sum: ["142 ms", "486 B"], body: () => loginBody(false), send: true },
    { req: "login", title: "Create session", method: "POST", url: `${V}/post`, pane: loginReq, sum: ["142 ms", "486 B"], body: () => loginBody(true), send: false },
    { req: "profile", title: "Fetch profile", method: "GET", url: `${V}/get?user=${R("user")}`, pane: profileReq, sum: ["118 ms", "412 B"], body: () => profileBody, send: true },
  ];
  const win = $("[data-demo]");
  const tabs = $$(".steps button");
  const demo = (() => {
    let sendT = 0, nextT = 0, current = -1, seen = false, inView = false;
    let auto = !reduced;
    const schedule = () => {
      clearTimeout(nextT);
      if (auto && inView) nextT = setTimeout(() => show((current + 1) % states.length), current === 2 ? 5200 : 3800);
    };
    const show = (i, instant) => {
      const s = states[i];
      current = i;
      clearTimeout(sendT);
      clearTimeout(nextT);
      win.dataset.state = String(i);
      tabs.forEach((t) => t.setAttribute("aria-selected", String(+t.dataset.step === i)));
      $$(".w-reqs li", win).forEach((li) => li.classList.toggle("on", li.dataset.req === s.req));
      $("[data-title]", win).textContent = s.title;
      $("[data-method]", win).textContent = s.method;
      $("[data-url]", win).innerHTML = s.url;
      $("[data-req-pane]", win).innerHTML = s.pane;
      const sum = $("[data-sum]", win);
      sum.innerHTML = `<span class="w-status">200 OK</span><span><small>Time</small>${s.sum[0]}</span><span><small>Size</small>${s.sum[1]}</span>`;
      const body = $("[data-body]", win);
      const land = () => {
        win.removeAttribute("data-sending");
        body.innerHTML = s.body();
        body.style.opacity = "1";
        sum.style.opacity = "1";
        schedule();
      };
      if (s.send && !reduced && !instant) {
        win.setAttribute("data-sending", "");
        body.style.opacity = "0";
        sum.style.opacity = "0";
        sendT = setTimeout(land, 1100);
      } else land();
    };
    tabs.forEach((t) => t.addEventListener("click", () => { auto = false; show(+t.dataset.step); }));
    tabs.forEach((t) => t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = (+t.dataset.step + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      auto = false; show(n); tabs[n].focus();
    }));
    new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      if (!inView) { clearTimeout(nextT); return; }
      if (!seen) { seen = true; show(0); } else if (!win.hasAttribute("data-sending")) schedule();
    }, { threshold: 0.35 }).observe(win);
    show(0, true);
    return { play: (i) => { auto = !reduced; seen = true; show(i); } };
  })();

  /* ——— Approval sheet ——— */
  const sheetResult = $("[data-sheet-result]");
  $$("[data-sheet]").forEach((b) => b.addEventListener("click", () => {
    sheetResult.hidden = false;
    sheetResult.textContent = {
      once: "Allowed once. The run appears in History as “Claude”.",
      session: "Allowed until you quit Tether. Revoke anytime in Settings.",
      deny: "Denied. Claude gets a refusal, and the attempt is logged.",
    }[b.dataset.sheet];
  }));

  /* ——— Copy buttons ——— */
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const text = b.previousElementSibling.textContent;
    try { await navigator.clipboard.writeText(text); } catch { return; }
    $("use", b).setAttribute("href", "#i-check");
    b.setAttribute("aria-label", "Copied");
    setTimeout(() => { $("use", b).setAttribute("href", "#i-copy"); b.setAttribute("aria-label", "Copy command"); }, 1400);
  }));
})();
