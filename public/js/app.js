/* ===== HindiAnime app ===== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);

  const state = {
    catalog: [],
    current: null, // {title, sub, items:[{label,url}], idx}
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
  const modalExternal = $("#modal-external");

  function openPlayer(config) {
    // config: {title, sub, items:[{label,url}], idx}
    state.current = config;
    modalTitle.textContent = config.title;
    modalSub.textContent = config.sub || "";
    playIndex(config.idx || 0);
    renderPills();
    show(modal);
    document.body.style.overflow = "hidden";
  }

  function playIndex(i) {
    const cur = state.current;
    if (!cur || !cur.items[i]) return;
    cur.idx = i;
    const url = cur.items[i].url;
    player.src = url;
    modalExternal.href = url;
    renderPills();
  }

  function renderPills() {
    const cur = state.current;
    modalPills.innerHTML = "";
    if (!cur || !cur.items || cur.items.length < 2) return;
    cur.items.forEach((it, i) => {
      const b = document.createElement("button");
      b.className = "pill" + (i === cur.idx ? " active" : "");
      b.textContent = it.label;
      b.onclick = () => playIndex(i);
      modalPills.appendChild(b);
    });
  }

  function closePlayer() {
    hide(modal);
    player.src = "about:blank";
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
