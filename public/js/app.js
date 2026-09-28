/* ===== HindiAnime app ===== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);

  const state = {
    catalog: [],
    // {title, sub, items:[{label, url?, servers?:[{name,url}]}], idx, sidx}
    current: null,
  };

  /* ---------- helpers ---------- */
  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.success === false) {
      const msg =
        (data && (data.message || data.error)) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data.data !== undefined ? data.data : data;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  /* ---------- modal player ---------- */
  const modal = $("#modal");
  const player = $("#player");
  const modalTitle = $("#modal-title");
  const modalSub = $("#modal-sub");
  const modalPills = $("#modal-pills");
  const modalServers = $("#modal-servers");
  const modalExternal = $("#modal-external");
  const modalHint = $("#modal-hint");
  const DEFAULT_HINT = modalHint.innerHTML;
  const VIDSYNC_HINT =
    "VidSync chal raha hai — <b>ad-free</b>. Hindi availability check ho raha hai; " +
    "audio ya server manually badalni ho to player ke <b>menus</b> use karo.";

  // item: {label, url} (flat) ya {label, servers:[{name,url}]}
  function itemServers(item) {
    if (item.servers && item.servers.length) return item.servers;
    return item.url ? [{ name: "Server", url: item.url }] : [];
  }

  function openPlayer(config) {
    // config: {title, sub, items:[{label,url|servers}], idx, sidx}
    state.current = Object.assign({ idx: 0, sidx: 0 }, config);
    modalTitle.textContent = config.title;
    modalSub.textContent = config.sub || "";
    renderPlayer();
    show(modal);
    document.body.style.overflow = "hidden";
  }

  function playIndex(i, sidx) {
    const cur = state.current;
    if (!cur || !cur.items[i]) return;
    cur.idx = i;
    cur.sidx = sidx || 0;
    renderPlayer();
  }

  function playServer(j) {
    const cur = state.current;
    if (!cur) return;
    cur.sidx = j;
    renderPlayer();
  }

  function renderPlayer() {
    const cur = state.current;
    if (!cur) return;
    const item = cur.items[cur.idx];
    const servers = itemServers(item);
    if (!servers.length) return;
    if (cur.sidx >= servers.length) cur.sidx = 0;
    const url = servers[cur.sidx].url;
    player.src = url;
    modalExternal.href = url;
    if (isVidSync(url)) {
      attachVidSync();
      modalHint.innerHTML = VIDSYNC_HINT;
      runVsProbe(url, servers);
    } else {
      detachVidSync();
      modalHint.innerHTML = DEFAULT_HINT;
    }
    renderPills();
    renderServerPills(servers);
  }

  /* ---------- VidSync (vidsync.pro) — ad-free player + Hindi permanent solution ----------
     vidsync ka apna public API /api/core/streams (CORS *) batata hai ki is episode
     me Hindi audio track hai ya nahi:
       • Hindi MILA   → VidSync default rehta hai; setServer usi provider pe
                         target (Moviebox ka Hindi stream vidsync relay se chalta
                         hai) + setAudio Hindi battery.
       • Hindi NAHI   → automatically "Hindi" (AnimeSalt dub) pill pe switch —
                         guaranteed Hindi dub, bina kisi manual step ke.
     Player ko postMessage se control: setServer/setAudio ke payload publicly
     unknown hain, isliye composite key-variants spray hote hain — bridge
     andar try/catch me sab no-op-safe rakhta hai. READY/ERROR + retries. */
  const VS_VARIANTS = [
    { lang: "hi", language: "hi", audio: "hi", track: "hi", label: "hi", name: "hi", code: "hin", id: "hi" },
    { lang: "hindi", language: "hindi", audio: "hindi", track: "hindi", label: "hindi", name: "hindi", code: "hindi", id: "hindi" },
    { lang: "Hindi", language: "Hindi", audio: "Hindi", track: "Hindi", label: "Hindi", name: "Hindi", code: "Hindi", id: "Hindi" },
    { audio: { lang: "hi", language: "hindi", label: "Hindi", name: "Hindi", code: "hin" } },
  ];
  let vsTarget = "GogoAnime";   // setServer target (fireAll call-time pe padhta hai)
  let vsReadySeen = false;
  let vsFire = null;            // attachVidSync ke andar set hota hai (late probe re-fire)
  const vsProbeCache = new Map();     // "id:ep" -> {hindi, provider, at} (5 min TTL)
  const vsAutoSwitched = new Set();   // user ke liye ek baar auto-switch (phir uski marzi)

  function serverVariants(target) {
    const t = String(target || "GogoAnime");
    const forms = [t, t.charAt(0).toUpperCase() + t.slice(1), t.toLowerCase()];
    if (/gogo/i.test(t)) forms.push("GogoAnime", "Gogoanime", "gogoanime");
    const seen = new Set();
    const vars = [];
    forms.forEach((f) => {
      if (!f || seen.has(f)) return;
      seen.add(f);
      vars.push({ server: f, name: f, provider: f, source: f, label: f, id: f, target: f, value: f });
    });
    const f0 = t;
    vars.push({ server: { name: f0, id: t.toLowerCase(), label: f0 } });
    return vars;
  }

  function isVidSync(url) {
    return /vidsync\.(pro|xyz)/.test(url || "");
  }

  // GET /api/core/streams → { sources[], audioTracks[], providers[] }
  async function probeVidSyncHindi(url) {
    const m = /embed\/anime\/(\d+)(?:\/(\d+))?/.exec(url || "");
    if (!m) return null;
    const key = m[1] + ":" + (m[2] || "1");
    const hit = vsProbeCache.get(key);
    if (hit && Date.now() - hit.at < 300000) return hit;
    try {
      const api =
        "https://vidsync.pro/api/core/streams?type=anime&id=" + m[1] +
        "&season=1&episode=" + (m[2] || 1);
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(api, { signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const isHi = (v) => {
        const l = String(v || "").trim().toLowerCase();
        return l === "hi" || l === "hin" || l === "hindi" || l.includes("hindi");
      };
      const langs = new Set();
      const pushTrack = (t) => {
        if (!t) return;
        const l = String(t.language || t.label || "").trim().toLowerCase();
        if (l) langs.add(l);
      };
      (j.audioTracks || []).forEach(pushTrack);
      let provider = null;
      (j.sources || []).forEach((s) => {
        (s.audioTracks || []).forEach((t) => {
          pushTrack(t);
          if (!provider && isHi(t.language || t.label)) {
            provider = (s.provider && (s.provider.name || s.provider.id)) || null;
          }
        });
        if (isHi(s.language || s.audioTrack)) {
          langs.add(String(s.language || s.audioTrack).toLowerCase());
          if (!provider) provider = (s.provider && (s.provider.name || s.provider.id)) || null;
        }
      });
      const out = { hindi: [...langs].some(isHi), provider: provider, at: Date.now() };
      vsProbeCache.set(key, out);
      return out;
    } catch (_) {
      return null; // network/CORS/API fail → silent fallback to default behaviour
    }
  }

  async function runVsProbe(url, servers) {
    vsTarget = "GogoAnime";
    const res = await probeVidSyncHindi(url);
    // guards: tab tak hi apply karo jab tak wahi server + wahi default selection
    const cur = state.current;
    if (!cur) return;
    const srv = itemServers(cur.items[cur.idx])[cur.sidx];
    if (!srv || srv.url !== url || cur.sidx !== 0) return;
    const key = url;
    if (res && res.hindi) {
      vsTarget = res.provider || "Moviebox";
      modalHint.innerHTML =
        "VidSync me <b>is episode ka Hindi source mil gaya</b> — audio apne aap " +
        "<b>Hindi</b> pe switch hoga 🎬 (Moviebox ka Hindi stream vidsync ke apne " +
        "relay se chalta hai).";
      if (vsReadySeen && vsFire) vsFire(); // READY pehle ho chuka to abhi re-fire
      return;
    }
    if (res && res.hindi === false && !vsAutoSwitched.has(key)) {
      const hiIdx = servers.findIndex((s) => /^hindi/i.test(String(s.name || "")));
      if (hiIdx >= 0) {
        vsAutoSwitched.add(key);
        playServer(hiIdx); // → AnimeSalt Hindi dub (guaranteed)
        modalHint.innerHTML =
          "VidSync ke sources me <b>is episode ka Hindi nahi hai</b> — apne aap " +
          "<b>AnimeSalt Hindi Dub</b> pe switch ho gaya ✅. VidSync hi chahiye to " +
          "upar <b>VidSync</b> pill dabao.";
        return;
      }
      modalHint.innerHTML =
        "VidSync pe is episode ka Hindi source nahi mila — neeche <b>Hindi</b> " +
        "pill (AnimeSalt dub) try karo.";
    }
  }

  function attachVidSync() {
    detachVidSync();
    vsReadySeen = false;
    let timers = [];
    const postCmd = (command, payload) => {
      try {
        const w = player.contentWindow;
        if (w) w.postMessage(Object.assign({ type: "VIDSYNC_COMMAND", command: command }, payload), "*");
      } catch (_) {}
    };
    const fireAll = () => {
      vsReadySeen = true;
      // 1) provider force (Hindi provider > GogoAnime), 2) Hindi audio, 3) play kick
      serverVariants(vsTarget).forEach((v, i) =>
        timers.push(setTimeout(() => postCmd("setServer", v), i * 80)));
      VS_VARIANTS.forEach((v, i) =>
        timers.push(setTimeout(() => postCmd("setAudio", v), 600 + i * 200)));
      timers.push(setTimeout(() => postCmd("play", { autoplay: true }), 1600));
    };
    const scheduleRetries = () => {
      [2500, 7000, 15000].forEach((t) => timers.push(setTimeout(fireAll, t)));
    };
    const kick = () => {
      timers.forEach(clearTimeout);
      timers = [];
      fireAll();
      scheduleRetries();
    };
    const onMsg = (e) => {
      if (e.source !== player.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "VIDSYNC_READY" || d.type === "VIDSYNC_ERROR") kick();
    };
    window.addEventListener("message", onMsg);
    vsFire = kick;
    vsDetach = () => {
      window.removeEventListener("message", onMsg);
      timers.forEach(clearTimeout);
      vsFire = null;
      vsReadySeen = false;
    };
  }

  function detachVidSync() {
    if (vsDetach) {
      vsDetach();
      vsDetach = null;
    }
  }

  function renderPills() {
    const cur = state.current;
    modalPills.innerHTML = "";
    if (!cur || !cur.items || cur.items.length < 2) return;
    cur.items.forEach((it, i) => {
      const b = document.createElement("button");
      b.className = "pill" + (i === cur.idx ? " active" : "");
      b.textContent = it.label;
      b.onclick = () => playIndex(i, 0);
      modalPills.appendChild(b);
    });
  }

  function renderServerPills(servers) {
    modalServers.innerHTML = "";
    if (!servers || servers.length < 2) return;
    servers.forEach((s, j) => {
      const b = document.createElement("button");
      b.className = "pill pill-server" + (j === state.current.sidx ? " active" : "");
      b.textContent = s.name || `Server ${j + 1}`;
      b.onclick = () => playServer(j);
      modalServers.appendChild(b);
    });
  }

  function closePlayer() {
    detachVidSync();
    vsAutoSwitched.clear();
    vsProbeCache.clear();
    hide(modal);
    player.src = "about:blank";
    modalHint.innerHTML = DEFAULT_HINT;
    document.body.style.overflow = "";
    state.current = null;
  }

  $("#modal-close").onclick = closePlayer;
  modal.addEventListener("click", (e) => { if (e.target === modal) closePlayer(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closePlayer();
  });

  /* ---------- home: 5 anime ---------- */
  function renderGrid() {
    const grid = $("#anime-grid");
    grid.innerHTML = "";
    state.catalog.forEach((a) => {
      const card = document.createElement("article");
      card.className = "card";
      const eps = a.type === "Movie"
        ? a.episodes.map((e) => e.label).join(" · ")
        : `${a.episodes.length} Episodes`;
      card.innerHTML = `
        <div class="card-poster">
          <img src="${esc(a.poster)}" alt="${esc(a.title)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
          <div class="fallback">🍥</div>
          <span class="card-badge">★ ${esc(a.rating)}</span>
          <span class="card-type">${esc(a.type)}</span>
          <div class="card-play">▶</div>
        </div>
        <div class="card-body">
          <div class="card-title">${esc(a.title)}</div>
          <div class="card-meta">
            <span class="chip">${esc(a.year)}</span>
            <span class="chip">🔊 ${esc(a.audioBadge)}</span>
            <span class="chip">${esc(eps)}</span>
          </div>
        </div>`;
      card.onclick = () =>
        openPlayer({
          title: a.title,
          sub: `${a.type} · ${a.audioBadge} · ${a.languages.join(", ")}`,
          items: a.episodes,
          idx: 0,
        });
      grid.appendChild(card);
    });
  }

  /* ---------- search (Renime API) ---------- */
  const searchSection = $("#search-section");
  const homeSection = $("#home-section");
  const searchResults = $("#search-results");
  const searchStatus = $("#search-status");
  const detailPanel = $("#detail-panel");
  const searchTitle = $("#search-title");

  function showSearchView() {
    hide(homeSection);
    show(searchSection);
    window.scrollTo({ top: 0 });
  }
  function showHomeView() {
    hide(searchSection);
    show(homeSection);
    detailPanel.innerHTML = "";
    searchResults.innerHTML = "";
    hide(searchStatus);
    $("#search-input").value = "";
  }

  $("#search-back").onclick = showHomeView;
  $("#logo").onclick = (e) => { e.preventDefault(); showHomeView(); };

  function setStatus(msg, kind) {
    searchStatus.className = "status" + (kind ? " " + kind : "");
    searchStatus.innerHTML = msg;
    show(searchStatus);
  }

  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#search-input").value.trim();
    if (!q) return;

    showSearchView();
    searchTitle.textContent = `Search: "${esc(q)}"`;
    detailPanel.innerHTML = "";
    searchResults.innerHTML = '<div class="spinner"></div>';
    hide(searchStatus);

    try {
      const data = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`);
      // shapes: {items:[...]} | [...] | {results:[...]}
      const items = Array.isArray(data) ? data
        : data.items || data.results || (data.data && data.data.items) || [];

      searchResults.innerHTML = "";
      if (!items.length) {
        setStatus("Kuch nahi mila. Doosra keyword try karo.", "err");
        return;
      }
      items.forEach((it) => {
        const id = it.id || it.slug || "";
        const title = it.title || it.name || id;
        const img = it.image || it.poster || "";
        const type = it.type || "";
        const card = document.createElement("div");
        card.className = "result-card";
        card.innerHTML = `
          <div class="result-poster">
            ${img ? `<img src="${esc(img)}" alt="${esc(title)}" loading="lazy"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />` : ""}
            <div class="ph">🎬</div>
          </div>
          <div class="result-body">
            <div class="result-title">${esc(title)}</div>
            ${type ? `<div class="card-meta"><span class="chip">${esc(type)}</span></div>` : ""}
          </div>`;
        card.onclick = () => openDetail(id, title);
        searchResults.appendChild(card);
      });
    } catch (err) {
      searchResults.innerHTML = "";
      setStatus(
        `⚠️ Search API abhi available nahi hai — <b>${esc(err.message)}</b>.<br>` +
        `Provider (animesalt) block ho sakta hai ya server busy hai, thodi der baad try karo.`,
        "err"
      );
    }
  });

  /* ---------- detail: info → seasons → episodes → embed ---------- */
  async function openDetail(id, fallbackTitle) {
    searchResults.innerHTML = "";
    hide(searchStatus);
    searchTitle.textContent = fallbackTitle || "Details";
    detailPanel.innerHTML = '<div class="spinner"></div>';

    try {
      const info = await fetchJSON(`/api/info/${encodeURIComponent(id)}`);
      renderDetail(id, info);
    } catch (err) {
      detailPanel.innerHTML =
        `<div class="status err">⚠️ Details nahi mil payi — <b>${esc(err.message)}</b>.</div>` +
        `<button class="btn-outline" onclick="location.reload()">← Wapas</button>`;
    }
  }

  function renderDetail(id, info) {
    const title = info.title || id;
    const img = info.image || "";
    const desc = info.description || "";
    const langs = Array.isArray(info.languages) ? info.languages : [];
    const seasons = info.seasonsList || info.seasons || [];
    const type = (info.type || "").toLowerCase();

    const isMovie = type === "movie" || (seasons.length === 0);

    detailPanel.innerHTML = `
      <div class="detail">
        <div class="detail-top">
          <div class="detail-poster">
            ${img ? `<img src="${esc(img)}" alt="${esc(title)}" />` : ""}
          </div>
          <div class="detail-info">
            <h3>${esc(title)}</h3>
            <div class="row">
              ${langs.map((l) => `<span class="chip">🔊 ${esc(l)}</span>`).join("")}
              ${info.type ? `<span class="chip">${esc(info.type)}</span>` : ""}
            </div>
            <p>${esc(desc)}</p>
            <div class="detail-actions">
              <button class="btn" id="d-play">▶ Play</button>
              <button class="btn-outline" id="d-back">← Results</button>
            </div>
          </div>
        </div>
        <div id="d-seasons"></div>
        <div class="detail-sub hidden" id="d-eps-label">Episodes</div>
        <div class="ep-list" id="d-eps"></div>
      </div>`;

    $("#d-back").onclick = () => { detailPanel.innerHTML = ""; showHomeView(); };

    const seasonsBox = $("#d-seasons");
    const epsBox = $("#d-eps");
    const epsLabel = $("#d-eps-label");

    async function loadSeason(season) {
      seasonsBox.querySelectorAll(".btn-outline").forEach((b) =>
        b.classList.toggle("active", b.dataset.s === String(season)));
      epsBox.innerHTML = '<div class="spinner"></div>';
      show(epsLabel); show(epsBox);
      try {
        const data = await fetchJSON(
          `/api/episodes/${encodeURIComponent(id)}/${encodeURIComponent(season)}`
        );
        const eps = data.episodes || data.items || (Array.isArray(data) ? data : []);
        epsBox.innerHTML = "";
        if (!eps.length) {
          epsBox.innerHTML = '<div class="status">Is season ke episodes nahi mile.</div>';
          return;
        }
        eps.forEach((ep) => {
          const label = ep.title
            || (ep.season && ep.episode ? `S${ep.season} E${ep.episode}` : "Episode");
          const b = document.createElement("button");
          b.className = "ep-item";
          b.textContent = label;
          b.onclick = () => playFromServer(ep.id || ep.slug, b, epsBox);
          epsBox.appendChild(b);
        });
      } catch (err) {
        epsBox.innerHTML = `<div class="status err">Episodes error: <b>${esc(err.message)}</b></div>`;
      }
    }

    // Season buttons (series) — movie ke liye seedha episodes (season 1)
    if (!isMovie && seasons.length) {
      seasons.forEach((s) => {
        const b = document.createElement("button");
        b.className = "btn-outline";
        b.dataset.s = String(s);
        b.textContent = `Season ${s}`;
        b.onclick = () => loadSeason(s);
        seasonsBox.appendChild(b);
      });
      $("#d-play").onclick = () => loadSeason(seasons[0]);
      loadSeason(seasons[0]);
    } else {
      // Movie (ya seasons nahi mile) — pehle seedha embed try karo,
      // warna season 1 ke episodes kholo.
      $("#d-play").onclick = async () => {
        epsBox.innerHTML = '<div class="spinner"></div>';
        show(epsLabel); show(epsBox);
        try {
          const data = await fetchJSON(`/api/embed/${encodeURIComponent(id)}`);
          const servers = data.servers || [];
          if (servers.length) {
            openPlayer({
              title,
              sub: `Server: ${servers.map((s) => s.name).join(" · ")}`,
              items: servers.map((s) => ({ label: s.name || "Server", url: s.url })),
              idx: 0,
            });
            return;
          }
          throw new Error("Koi server nahi mila");
        } catch (_) {
          loadSeason(1);
        }
      };
      loadSeason(1);
    }

    async function playFromServer(epId, btn, box) {
      if (!epId) return;
      box.querySelectorAll(".ep-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      try {
        const data = await fetchJSON(`/api/embed/${encodeURIComponent(epId)}`);
        const servers = data.servers || data.items || [];
        if (!servers.length) throw new Error("Koi server nahi mila");
        openPlayer({
          title,
          sub: `Server: ${servers.map((s) => s.name).join(" · ")}`,
          items: servers.map((s) => ({
            label: s.name || `Server ${s.server || ""}`,
            url: s.url,
          })),
          idx: 0,
        });
      } catch (err) {
        setStatus(`⚠️ Embed error: <b>${esc(err.message)}</b>`, "err");
        show(searchStatus);
      }
    }
  }

  /* ---------- boot ---------- */
  fetchJSON("data/anime.json")
    .then((d) => {
      state.catalog = d.anime || [];
      renderGrid();
    })
    .catch(() => {
      $("#anime-grid").innerHTML =
        '<div class="status err">Catalog load nahi hua — refresh karo.</div>';
    });
})();
