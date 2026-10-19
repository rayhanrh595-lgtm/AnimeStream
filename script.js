/* ==========================================================================
   PixelPlay Arcade — script.js
   Single front-end file: catalog loading, rendering, search/filter/sort,
   favourites, recent history, routing, the game player and six original
   canvas games implemented in this file.

   NOTE: `games.json` is fetched with fetch(). Opening index.html directly
   from the file system (file://) will block that request in most browsers.
   Serve the folder over HTTP — see README.md.
   ========================================================================== */

(function () {
  "use strict";

  /* ======================================================================
     1. Constants & tiny helpers
     ====================================================================== */

  var FAV_KEY = "pixelplay.favorites.v1";
  var RECENT_KEY = "pixelplay.recent.v1";
  var RECENT_MAX = 12;

  var BUILTIN_ENGINES = ["breakout", "dodger", "snake", "reflex", "pong", "memory"];
  var BUILTIN_SET = new Set(BUILTIN_ENGINES);

  var DEFAULT_THEME = { from: "#8b5cf6", to: "#22d3ee", glyph: "\u25C6" };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function str(v, fallback) {
    return typeof v === "string" ? v : (fallback || "");
  }

  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* Storage may be unavailable (private mode / quota). Fail silently. */
    }
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    try {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return iso;
    }
  }

  /* ======================================================================
     2. Application state
     ====================================================================== */

  var state = {
    games: [],
    byId: new Map(),
    categories: [],
    view: "home",
    infoPage: "about",
    search: "",
    category: "all",
    sort: "popular",
    current: null,
    favorites: new Set(
      (readStore(FAV_KEY, []) || []).filter(function (x) { return typeof x === "string"; })
    ),
    recent: (readStore(RECENT_KEY, []) || []).filter(function (x) { return typeof x === "string"; })
  };

  /* ======================================================================
     3. DOM references
     ====================================================================== */

  var els = {};

  function cacheDom() {
    els.header = $("#site-header");
    els.nav = $("#primary-nav");
    els.menuToggle = $("#menu-toggle");
    els.searchForm = $("#search-form");
    els.searchInput = $("#search-input");
    els.searchClear = $("#search-clear");

    els.heroPlay = $("#hero-play-featured");
    els.statGames = $("#stat-games");
    els.statCategories = $("#stat-categories");

    els.featuredMount = $("#featured-mount");
    els.categoryGrid = $("#category-grid");
    els.popularGrid = $("#popular-grid");
    els.latestGrid = $("#latest-grid");

    els.librarySummary = $("#library-summary");
    els.categoryChips = $("#category-chips");
    els.sortSelect = $("#sort-select");
    els.libraryStatus = $("#library-status");
    els.libraryGrid = $("#library-grid");

    els.favoritesEmpty = $("#favorites-empty");
    els.favoritesGrid = $("#favorites-grid");

    els.recentEmpty = $("#recent-empty");
    els.recentGrid = $("#recent-grid");
    els.recentClear = $("#recent-clear");

    els.views = $$(".view");
    els.infoBlocks = $$(".info-block");

    els.playerBack = $("#player-back");
    els.playerTitle = $("#player-title");
    els.playerMeta = $("#player-meta");
    els.btnPlay = $("#btn-play");
    els.btnPause = $("#btn-pause");
    els.btnRestart = $("#btn-restart");
    els.btnFullscreen = $("#btn-fullscreen");
    els.btnFavorite = $("#btn-favorite");

    els.stage = $("#player-stage");
    els.gameMount = $("#game-mount");
    els.stageHud = $("#stage-hud");
    els.hudScore = $("#hud-score");
    els.hudStatus = $("#hud-status");
    els.stageOverlay = $("#stage-overlay");
    els.overlayTitle = $("#overlay-title");
    els.overlayText = $("#overlay-text");
    els.overlayAction = $("#overlay-action");
    els.stageHint = $("#stage-hint");
    els.playerInstructions = $("#player-instructions");
    els.playerDetails = $("#player-details");
    els.relatedGrid = $("#related-grid");

    els.toasts = $("#toast-container");
    els.year = $("#year");
  }

  /* ======================================================================
     4. Toasts
     ====================================================================== */

  function toast(message, kind) {
    if (!els.toasts) return;
    var node = el("div", "toast" + (kind ? " is-" + kind : ""), message);
    els.toasts.appendChild(node);
    var remove = function () {
      node.classList.add("is-leaving");
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 240);
    };
    var timer = window.setTimeout(remove, 3600);
    node.addEventListener("click", function () {
      window.clearTimeout(timer);
      remove();
    });
  }

  /* ======================================================================
     5. Catalog loading & normalisation
     ====================================================================== */

  function normalizeGame(raw, index) {
    if (!raw || typeof raw !== "object") return null;

    var id = str(raw.id) || str(raw.slug) || ("game-" + index);
    var title = str(raw.title) || "Untitled Game";
    var slug = str(raw.slug) || id;

    var theme = (raw.theme && typeof raw.theme === "object") ? raw.theme : {};

    var game = {
      id: id,
      title: title,
      slug: slug,
      description: str(raw.description) || "No description provided.",
      category: str(raw.category) || "Uncategorised",
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter(function (t) { return typeof t === "string"; }).slice(0, 8)
        : [],
      thumbnail: str(raw.thumbnail),
      theme: {
        from: str(theme.from) || DEFAULT_THEME.from,
        to: str(theme.to) || DEFAULT_THEME.to,
        glyph: str(theme.glyph) || DEFAULT_THEME.glyph
      },
      sourceType: str(raw.sourceType) || "builtin",
      engine: str(raw.engine),
      url: str(raw.url),
      provider: str(raw.provider) || "Unknown",
      license: str(raw.license) || "Not specified",
      embedAllowed: raw.embedAllowed === true,
      verified: raw.verified === true,
      published: raw.published !== false,
      featured: raw.featured === true,
      popularity: typeof raw.popularity === "number" ? raw.popularity : 0,
      addedAt: str(raw.addedAt),
      instructions: Array.isArray(raw.instructions)
        ? raw.instructions.filter(function (s) { return typeof s === "string"; })
        : [],
      controls: str(raw.controls) || "—"
    };

    if (game.sourceType === "builtin" && !BUILTIN_SET.has(game.engine)) {
      game.published = false; // unsupported engine -> hide rather than crash
    }
    return game;
  }

  function loadCatalog() {
    setLibraryStatus("loading", "Loading game catalog…");

    return fetch("games.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " while loading games.json");
        return res.json();
      })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data && Array.isArray(data.games) ? data.games : null);
        if (!list) throw new Error("games.json does not contain a games array");

        var games = [];
        list.forEach(function (raw, i) {
          var g = normalizeGame(raw, i);
          if (g) games.push(g);
        });

        games = games.filter(function (g) { return g.published; });

        // De-duplicate by id, keeping the first occurrence.
        var seen = new Set();
        games = games.filter(function (g) {
          if (seen.has(g.id)) return false;
          seen.add(g.id);
          return true;
        });

        state.games = games;
        state.byId = new Map();
        games.forEach(function (g) { state.byId.set(g.id, g); });

        var cats = [];
        games.forEach(function (g) {
          if (cats.indexOf(g.category) === -1) cats.push(g.category);
        });
        cats.sort();
        state.categories = cats;

        return games;
      });
  }

  function setLibraryStatus(mode, message) {
    if (!els.libraryStatus) return;
    if (!mode) {
      els.libraryStatus.hidden = true;
      els.libraryStatus.textContent = "";
      els.libraryStatus.className = "state-block";
      return;
    }
    els.libraryStatus.hidden = false;
    els.libraryStatus.className = "state-block" + (mode === "error" ? " is-error" : "");
    els.libraryStatus.textContent = "";

    if (mode === "loading") {
      var sp = el("span", "loader");
      sp.setAttribute("aria-hidden", "true");
      els.libraryStatus.appendChild(sp);
    }
    els.libraryStatus.appendChild(document.createTextNode(message));
  }

  /* ======================================================================
     6. Card factory
     ====================================================================== */

  function createGameCard(game, small) {
    var card = el("article", "game-card");
    card.dataset.id = game.id;

    /* --- thumbnail button --- */
    var thumb = el("button", "card-thumb");
    thumb.type = "button";
    thumb.setAttribute("aria-label", "Open " + game.title);
    thumb.style.setProperty("--c1", game.theme.from);
    thumb.style.setProperty("--c2", game.theme.to);

    var glyph = el("span", "thumb-glyph", game.theme.glyph);
    glyph.setAttribute("aria-hidden", "true");
    thumb.appendChild(glyph);

    if (game.thumbnail) {
      var img = el("img");
      img.src = game.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      thumb.appendChild(img);
    }

    var badge = el("span", "card-badge", game.category);
    thumb.appendChild(badge);

    thumb.addEventListener("click", function () { openGame(game.id); });
    card.appendChild(thumb);

    /* --- body --- */
    var body = el("div", "card-body");
    body.appendChild(el("h3", "card-title", game.title));
    body.appendChild(el("p", "card-desc", game.description));

    var foot = el("div", "card-foot");

    var tags = el("div", "card-tags");
    game.tags.slice(0, small ? 1 : 2).forEach(function (t) {
      tags.appendChild(el("span", "tag", t));
    });
    foot.appendChild(tags);

    var actions = el("div", "card-actions");

    var playBtn = el("button", "card-play", "Play");
    playBtn.type = "button";
    playBtn.setAttribute("aria-label", "Play " + game.title);
    playBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      openGame(game.id);
    });
    actions.appendChild(playBtn);

    var favBtn = el("button", "card-fav");
    favBtn.type = "button";
    favBtn.dataset.favFor = game.id;
    syncFavButton(favBtn, state.favorites.has(game.id));
    favBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleFavorite(game.id);
    });
    actions.appendChild(favBtn);

    foot.appendChild(actions);
    body.appendChild(foot);
    card.appendChild(body);

    return card;
  }

  function syncFavButton(btn, isFav) {
    btn.setAttribute("aria-pressed", isFav ? "true" : "false");
    btn.setAttribute("aria-label", isFav ? "Remove from favorites" : "Add to favorites");
    btn.textContent = isFav ? "\u2665" : "\u2661";
  }

  function renderGrid(container, games, small) {
    if (!container) return;
    container.textContent = "";
    games.forEach(function (g) {
      container.appendChild(createGameCard(g, !!small));
    });
  }

  /* ======================================================================
     7. Favorites & recent
     ====================================================================== */

  function toggleFavorite(id) {
    if (!state.byId.has(id)) return;
    var game = state.byId.get(id);
    var added;
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      added = false;
    } else {
      state.favorites.add(id);
      added = true;
    }
    writeStore(FAV_KEY, Array.from(state.favorites));

    // Sync every rendered favourite button for this game.
    $$('[data-fav-for="' + cssEscape(id) + '"]').forEach(function (b) {
      syncFavButton(b, added);
    });

    if (state.view === "favorites") renderFavorites();
    if (state.current && state.current.id === id) syncPlayerFavoriteButton();

    toast(added ? ('Added "' + game.title + '" to favorites') : ('Removed "' + game.title + '" from favorites'),
      added ? "success" : null);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function pushRecent(id) {
    if (!state.byId.has(id)) return;
    state.recent = state.recent.filter(function (x) { return x !== id; });
    state.recent.unshift(id);
    if (state.recent.length > RECENT_MAX) state.recent.length = RECENT_MAX;
    writeStore(RECENT_KEY, state.recent);
  }

  function clearRecent() {
    state.recent = [];
    writeStore(RECENT_KEY, []);
    renderRecent();
    toast("Play history cleared");
  }

  /* ======================================================================
     8. Home rendering
     ====================================================================== */

  function renderHome() {
    if (!state.games.length) return;

    els.statGames.textContent = String(state.games.length);
    els.statCategories.textContent = String(state.categories.length);

    renderFeatured();
    renderCategoryTiles();

    var popular = state.games.slice().sort(function (a, b) { return b.popularity - a.popularity; });
    renderGrid(els.popularGrid, popular.slice(0, 8), false);

    var latest = state.games.slice().sort(function (a, b) {
      return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
    });
    renderGrid(els.latestGrid, latest.slice(0, 8), false);
  }

  function renderFeatured() {
    var mount = els.featuredMount;
    if (!mount) return;
    mount.textContent = "";

    var game = state.games.find(function (g) { return g.featured; }) || state.games[0];
    if (!game) return;

    var card = el("article", "featured-card");

    var art = el("div", "featured-art");
    art.style.setProperty("--c1", game.theme.from);
    art.style.setProperty("--c2", game.theme.to);
    var glyph = el("div", "featured-glyph", game.theme.glyph);
    glyph.setAttribute("aria-hidden", "true");
    art.appendChild(glyph);
    card.appendChild(art);

    var info = el("div", "featured-info");
    info.appendChild(el("p", "featured-kicker", "Editor's pick"));
    info.appendChild(el("h3", null, game.title));
    info.appendChild(el("p", "featured-desc", game.description));

    var meta = el("div", "featured-meta");
    meta.appendChild(el("span", "tag", game.category));
    game.tags.slice(0, 3).forEach(function (t) { meta.appendChild(el("span", "tag", t)); });
    meta.appendChild(el("span", "tag", game.provider));
    info.appendChild(meta);

    var actions = el("div", "featured-actions");

    var play = el("button", "btn btn-primary", "Play Now");
    play.type = "button";
    play.addEventListener("click", function () { openGame(game.id); });
    actions.appendChild(play);

    var fav = el("button", "btn");
    fav.type = "button";
    fav.dataset.favFor = game.id;
    syncFavButton(fav, state.favorites.has(game.id));
    fav.style.width = "auto";
    fav.addEventListener("click", function () { toggleFavorite(game.id); });
    actions.appendChild(fav);

    var details = el("button", "btn btn-ghost", "Details");
    details.type = "button";
    details.addEventListener("click", function () { openGame(game.id); });
    actions.appendChild(details);

    info.appendChild(actions);
    card.appendChild(info);

    mount.appendChild(card);
  }

  function renderCategoryTiles() {
    var grid = els.categoryGrid;
    if (!grid) return;
    grid.textContent = "";

    state.categories.forEach(function (cat) {
      var count = state.games.filter(function (g) { return g.category === cat; }).length;

      var btn = el("button", "category-card");
      btn.type = "button";
      btn.setAttribute("aria-label", "Browse " + cat + " games (" + count + ")");

      var icon = el("span", "cat-icon", "\u25B8");
      icon.setAttribute("aria-hidden", "true");
      btn.appendChild(icon);
      btn.appendChild(el("span", "cat-name", cat));
      btn.appendChild(el("span", "cat-count", count + (count === 1 ? " game" : " games")));

      btn.addEventListener("click", function () {
        state.category = cat;
        state.search = "";
        if (els.searchInput) els.searchInput.value = "";
        if (els.searchClear) els.searchClear.hidden = true;
        renderCategoryChips();
        renderLibrary();
        navigate("library");
      });

      grid.appendChild(btn);
    });
  }

  /* ======================================================================
     9. Library rendering
     ====================================================================== */

  function renderCategoryChips() {
    var wrap = els.categoryChips;
    if (!wrap) return;
    wrap.textContent = "";

    var options = ["all"].concat(state.categories);
    options.forEach(function (cat) {
      var label = cat === "all" ? "All Games" : cat;
      var chip = el("button", "chip" + (state.category === cat ? " is-active" : ""), label);
      chip.type = "button";
      chip.setAttribute("aria-pressed", state.category === cat ? "true" : "false");
      chip.addEventListener("click", function () {
        state.category = cat;
        renderCategoryChips();
        renderLibrary();
      });
      wrap.appendChild(chip);
    });
  }

  function filteredGames() {
    var q = state.search.trim().toLowerCase();

    var list = state.games.filter(function (g) {
      if (state.category !== "all" && g.category !== state.category) return false;
      if (!q) return true;
      var haystack = (g.title + " " + g.category + " " + g.tags.join(" ") + " " + g.description).toLowerCase();
      return haystack.indexOf(q) !== -1;
    });

    list.sort(function (a, b) {
      if (state.sort === "title") return a.title.localeCompare(b.title);
      if (state.sort === "newest") return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
      return b.popularity - a.popularity;
    });

    return list;
  }

  function renderLibrary() {
    var list = filteredGames();

    if (els.librarySummary) {
      var bits = [];
      bits.push(list.length + (list.length === 1 ? " game" : " games"));
      if (state.category !== "all") bits.push("in " + state.category);
      if (state.search.trim()) bits.push('matching "' + state.search.trim() + '"');
      els.librarySummary.textContent = bits.join(" ");
    }

    if (!list.length) {
      renderGrid(els.libraryGrid, [], false);
      setLibraryStatus("empty", "No games match your filters. Try clearing the search or picking another category.");
      return;
    }

    setLibraryStatus(null, "");
    renderGrid(els.libraryGrid, list, false);
  }

  function renderFavorites() {
    var games = state.games.filter(function (g) { return state.favorites.has(g.id); });
    var has = games.length > 0;
    if (els.favoritesEmpty) els.favoritesEmpty.hidden = has;
    renderGrid(els.favoritesGrid, games, false);
  }

  function renderRecent() {
    var games = state.recent
      .map(function (id) { return state.byId.get(id); })
      .filter(Boolean);
    var has = games.length > 0;
    if (els.recentEmpty) els.recentEmpty.hidden = has;
    if (els.recentClear) els.recentClear.hidden = !has;
    renderGrid(els.recentGrid, games, false);
  }

  /* ======================================================================
     10. Routing
     ====================================================================== */

  function navigate(view, options) {
    options = options || {};

    if (view === "info") {
      state.infoPage = options.info || state.infoPage || "about";
    }

    state.view = view;

    els.views.forEach(function (v) {
      v.hidden = v.dataset.view !== view;
    });

    if (view === "info") {
      els.infoBlocks.forEach(function (b) {
        b.hidden = b.dataset.info !== state.infoPage;
      });
    }

    if (view === "library") renderLibrary();
    if (view === "favorites") renderFavorites();
    if (view === "recent") renderRecent();

    syncNavActive();
    closeMobileMenu();

    if (!options.keepScroll && view !== "player") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function syncNavActive() {
    var map = { home: "home", library: "library", favorites: "favorites", recent: "recent" };
    var active = map[state.view] || "";
    $$(".nav-link").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.nav === active);
    });
  }

  function closeMobileMenu() {
    if (!els.nav || !els.menuToggle) return;
    els.nav.classList.remove("is-open");
    els.menuToggle.setAttribute("aria-expanded", "false");
  }

  /* ======================================================================
     11. Player
     ====================================================================== */

  function openGame(id) {
    var game = state.byId.get(id);
    if (!game) {
      toast("That game is no longer available.", "error");
      return;
    }

    engine.stop();

    state.current = game;
    pushRecent(id);

    renderPlayer(game);
    navigate("player", { keepScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderPlayer(game) {
    els.playerTitle.textContent = game.title;
    els.playerMeta.textContent =
      game.category + " \u2022 " + game.provider + " \u2022 " + game.license;

    els.hudScore.textContent = "0";
    els.hudStatus.textContent = "Ready";

    /* instructions */
    els.playerInstructions.textContent = "";
    if (game.instructions.length) {
      var ul = el("ul");
      game.instructions.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      els.playerInstructions.appendChild(ul);
    } else {
      els.playerInstructions.appendChild(el("p", null, "No instructions provided."));
    }

    /* details */
    els.playerDetails.textContent = "";
    var rows = [
      ["Category", game.category],
      ["Controls", game.controls],
      ["Source", game.sourceType === "iframe" ? "External embed" : "Built-in canvas"],
      ["Provider", game.provider],
      ["Licence", game.license],
      ["Added", formatDate(game.addedAt)]
    ];
    rows.forEach(function (row) {
      els.playerDetails.appendChild(el("dt", null, row[0]));
      els.playerDetails.appendChild(el("dd", null, row[1]));
    });

    /* related */
    var related = state.games
      .filter(function (g) { return g.id !== game.id && g.category === game.category; })
      .sort(function (a, b) { return b.popularity - a.popularity; })
      .slice(0, 4);
    if (!related.length) {
      related = state.games
        .filter(function (g) { return g.id !== game.id; })
        .sort(function (a, b) { return b.popularity - a.popularity; })
        .slice(0, 4);
    }
    renderGrid(els.relatedGrid, related, true);

    /* controls state */
    els.btnPlay.disabled = false;
    els.btnPause.disabled = true;
    els.btnPause.title = "Pause is only available for built-in canvas games";
    els.btnRestart.disabled = true;

    els.stageHint.textContent = game.sourceType === "iframe"
      ? "External game — controls are provided by the game itself."
      : game.controls;

    syncPlayerFavoriteButton();

    /* reset stage */
    engine.stop();
    els.gameMount.textContent = "";
    els.stageHud.hidden = true;
    showOverlay("Ready to play?", "Press Play to start \u201C" + game.title + "\u201D.", "Play", startCurrentGame);
  }

  function syncPlayerFavoriteButton() {
    var game = state.current;
    if (!game) return;
    var isFav = state.favorites.has(game.id);
    els.btnFavorite.setAttribute("aria-pressed", isFav ? "true" : "false");
    els.btnFavorite.setAttribute("aria-label", isFav ? "Remove from favorites" : "Add to favorites");
    els.btnFavorite.textContent = "";
    var span = el("span", null, isFav ? "\u2665" : "\u2661");
    span.setAttribute("aria-hidden", "true");
    els.btnFavorite.appendChild(span);
  }

  function showOverlay(title, text, actionLabel, action) {
    els.overlayTitle.textContent = title;
    els.overlayText.textContent = text;
    els.overlayAction.textContent = actionLabel;
    els.overlayAction.hidden = !actionLabel;
    overlayAction = action || null;
    els.stageOverlay.hidden = false;
  }

  function hideOverlay() {
    els.stageOverlay.hidden = true;
    overlayAction = null;
  }

  var overlayAction = null;

  /* --- starting a game --- */

  function startCurrentGame() {
    var game = state.current;
    if (!game) return;

    if (game.sourceType === "builtin") {
      if (!BUILTIN_SET.has(game.engine)) {
        showOverlay("Cannot start", "This game uses an engine that is not bundled with this build.", "Back", function () { navigate("library"); });
        return;
      }
      els.gameMount.textContent = "";
      els.btnPlay.disabled = true;
      els.btnPause.disabled = false;
      els.btnRestart.disabled = false;
      els.stageHud.hidden = false;
      hideOverlay();
      try {
        engine.start(game.engine, els.gameMount, {
          score: function (v) { els.hudScore.textContent = String(v); },
          status: function (s) { els.hudStatus.textContent = s; },
          end: onGameEnd
        });
      } catch (err) {
        els.btnPlay.disabled = false;
        els.btnPause.disabled = true;
        els.btnRestart.disabled = true;
        els.stageHud.hidden = true;
        showOverlay("Game failed to start", "Something went wrong while initialising this game.", "Try again", startCurrentGame);
        toast("Could not start the game.", "error");
      }
      return;
    }

    if (game.sourceType === "iframe") {
      if (!game.embedAllowed || !game.verified) {
        showOverlay(
          "Not available for embedding",
          "This game is listed for reference only. Its provider has not granted embed permission, so it cannot be played here.",
          "Back to library",
          function () { navigate("library"); }
        );
        return;
      }
      if (!/^https:\/\//i.test(game.url)) {
        showOverlay(
          "Unsafe game source",
          "Only HTTPS embed URLs from verified providers are allowed.",
          "Back to library",
          function () { navigate("library"); }
        );
        return;
      }

      els.gameMount.textContent = "";
      var frame = el("iframe", "game-frame");
      frame.src = game.url;
      frame.title = game.title;
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";
      frame.setAttribute("allow", "fullscreen; autoplay; gamepad; clipboard-write");
      frame.setAttribute("allowfullscreen", "");
      els.gameMount.appendChild(frame);

      els.btnPlay.disabled = true;
      els.btnPause.disabled = true;
      els.btnPause.title = "This external game does not expose a pause control to the page.";
      els.btnRestart.disabled = true;
      els.stageHud.hidden = true;
      hideOverlay();
      return;
    }

    showOverlay("Unsupported source", "This game has an unknown source type and cannot be started.", "Back", function () { navigate("library"); });
  }

  function onGameEnd(message) {
    els.btnPlay.disabled = false;
    els.btnPause.disabled = true;
    els.hudStatus.textContent = "Game over";
    showOverlay(
      "Game over",
      message || "Nice run! Press Play again to give it another go.",
      "Play again",
      function () { startCurrentGame(); }
    );
  }

  /* ======================================================================
     12. Canvas game engine
     ====================================================================== */

  var engine = (function () {
    var e = {
      canvas: null,
      ctx: null,
      raf: 0,
      last: 0,
      running: false,
      paused: false,
      game: null,
      w: 1,
      h: 1,
      dpr: 1,
      hooks: {},
      ro: null,
      input: {
        keys: new Set(),
        px: -1,
        py: -1,
        down: false,
        taps: [],
        swipes: []
      }
    };

    function localPoint(canvas, ev) {
      var r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    var handlers = {
      down: function (ev) {
        if (!e.canvas) return;
        var p = localPoint(e.canvas, ev);
        e.input.down = true;
        e.input.px = p.x;
        e.input.py = p.y;
        e.input.taps.push({ x: p.x, y: p.y });
        e._swipeStart = { x: p.x, y: p.y, t: Date.now() };
        try { e.canvas.focus({ preventScroll: true }); } catch (err) { /* older browsers */ }
        ev.preventDefault();
      },
      move: function (ev) {
        if (!e.canvas) return;
        var p = localPoint(e.canvas, ev);
        e.input.px = p.x;
        e.input.py = p.y;
      },
      up: function () {
        e.input.down = false;
        if (e._swipeStart) {
          var dx = e.input.px - e._swipeStart.x;
          var dy = e.input.py - e._swipeStart.y;
          if (Math.abs(dx) > 26 || Math.abs(dy) > 26) {
            if (Math.abs(dx) > Math.abs(dy)) {
              e.input.swipes.push(dx > 0 ? "right" : "left");
            } else {
              e.input.swipes.push(dy > 0 ? "down" : "up");
            }
          }
          e._swipeStart = null;
        }
      },
      keydown: function (ev) {
        if (!e.running) return;
        var k = ev.key.toLowerCase();
        if (k === "arrowleft" || k === "arrowright" || k === "arrowup" || k === "arrowdown" || k === " ") {
          ev.preventDefault();
        }
        e.input.keys.add(k);
      },
      keyup: function (ev) {
        e.input.keys.delete(ev.key.toLowerCase());
      },
      blur: function () {
        e.input.keys.clear();
        e.input.down = false;
      }
    };

    e.resize = function () {
      if (!e.canvas) return;
      var rect = e.canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width));
      var h = Math.max(1, Math.round(rect.height));
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      if (e.canvas.width !== Math.round(w * dpr) || e.canvas.height !== Math.round(h * dpr)) {
        e.canvas.width = Math.round(w * dpr);
        e.canvas.height = Math.round(h * dpr);
      }
      e.w = w;
      e.h = h;
      e.dpr = dpr;
    };

    function tick(ts) {
      e.raf = window.requestAnimationFrame(tick);

      if (!e.running || e.paused || !e.game) {
        e.last = ts;
        return;
      }

      var dt = e.last ? (ts - e.last) / 1000 : 0.016;
      e.last = ts;
      if (!isFinite(dt) || dt <= 0) dt = 0.016;
      dt = Math.min(dt, 0.05);

      var ctx = e.ctx;
      ctx.setTransform(e.dpr, 0, 0, e.dpr, 0, 0);
      ctx.clearRect(0, 0, e.w, e.h);

      try {
        e.game.update(dt, e.input);
        e.game.draw(ctx, e.w, e.h);
      } catch (err) {
        e.stop();
        if (e.hooks.end) e.hooks.end("The game hit an unexpected error and was stopped.");
        return;
      }

      e.input.taps.length = 0;
      e.input.swipes.length = 0;
    }

    e.start = function (engineName, mountEl, hooks) {
      var factory = BUILTIN_GAMES[engineName];
      if (typeof factory !== "function") throw new Error("Unknown engine: " + engineName);

      e.stop();
      e.hooks = hooks || {};

      var canvas = document.createElement("canvas");
      canvas.className = "game-canvas";
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", "Game canvas. Use the arrow keys, mouse or touch.");
      mountEl.appendChild(canvas);
      e.canvas = canvas;
      e.ctx = canvas.getContext("2d");

      e.resize();

      if (window.ResizeObserver) {
        e.ro = new ResizeObserver(function () { e.resize(); });
        e.ro.observe(mountEl);
      } else {
        window.addEventListener("resize", e.resize);
      }

      canvas.addEventListener("pointerdown", handlers.down);
      canvas.addEventListener("pointermove", handlers.move);
      window.addEventListener("pointerup", handlers.up);
      window.addEventListener("keydown", handlers.keydown);
      window.addEventListener("keyup", handlers.keyup);
      window.addEventListener("blur", handlers.blur);

      var api = {
        get width() { return e.w; },
        get height() { return e.h; },
        setScore: function (v) { if (e.hooks.score) e.hooks.score(v); },
        setStatus: function (s) { if (e.hooks.status) e.hooks.status(s); },
        end: function (msg) {
          e.stop();
          if (e.hooks.end) e.hooks.end(msg);
        }
      };

      e.game = factory(api);
      e.running = true;
      e.paused = false;
      e.last = 0;

      if (api.setStatus) api.setStatus("Playing");
      if (api.setScore) api.setScore(0);

      e.raf = window.requestAnimationFrame(tick);
      try { canvas.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    };

    e.pause = function () {
      if (!e.running) return false;
      e.paused = true;
      e.input.keys.clear();
      return true;
    };

    e.resume = function () {
      if (!e.running) return false;
      e.paused = false;
      e.last = 0;
      return true;
    };

    e.stop = function () {
      if (e.raf) window.cancelAnimationFrame(e.raf);
      e.raf = 0;
      e.running = false;
      e.paused = false;
      e.game = null;

      if (e.ro) { e.ro.disconnect(); e.ro = null; }
      else { window.removeEventListener("resize", e.resize); }

      if (e.canvas) {
        e.canvas.removeEventListener("pointerdown", handlers.down);
        e.canvas.removeEventListener("pointermove", handlers.move);
      }
      window.removeEventListener("pointerup", handlers.up);
      window.removeEventListener("keydown", handlers.keydown);
      window.removeEventListener("keyup", handlers.keyup);
      window.removeEventListener("blur", handlers.blur);

      e.canvas = null;
      e.ctx = null;
      e.input.keys.clear();
      e.input.taps.length = 0;
      e.input.swipes.length = 0;
      e.input.down = false;
      e.input.px = -1;
      e.input.py = -1;
    };

    e.isPaused = function () { return e.paused; };
    e.isRunning = function () { return e.running; };

    return e;
  })();

  /* ======================================================================
     13. Built-in games
     ----------------------------------------------------------------------
     Every game below is an original implementation. Each factory receives
     an `api` object and returns { update(dt, input), draw(ctx, w, h) }.
     ====================================================================== */

  function rr(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function text(ctx, str, x, y, size, color, align) {
    ctx.fillStyle = color || "#fff";
    ctx.font = "700 " + size + "px Inter, system-ui, sans-serif";
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }

  /* ---------------------------------------------------------------------
     GAME 1 — Neon Breakout
     --------------------------------------------------------------------- */
  function createBreakout(api) {
    var ROW_COLORS = ["#f472b6", "#a78bfa", "#8b5cf6", "#22d3ee", "#34d399"];

    var paddleX = 0, paddleW = 110, paddleH = 14;
    var ball = { x: 0, y: 0, r: 8, vx: 0, vy: 0 };
    var bricks = [];
    var lives = 3, score = 0, over = false, won = false;
    var sizeKey = "";
    var launchDelay = 0.9;

    function buildBricks(w, h) {
      var cols = 8, rows = 5;
      var pad = Math.max(4, w * 0.01);
      var top = h * 0.13;
      var bw = (w - pad * (cols + 1)) / cols;
      var bh = Math.max(11, Math.min(22, h * 0.05));
      bricks = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          bricks.push({
            x: pad + c * (bw + pad),
            y: top + r * (bh + pad),
            w: bw, h: bh, alive: true, row: r
          });
        }
      }
    }

    function resetBall(w, h) {
      ball.r = clamp(Math.min(w, h) * 0.018, 5, 9);
      ball.x = paddleX + paddleW / 2;
      ball.y = h - 46 - ball.r;
      ball.vx = 0;
      ball.vy = 0;
      launchDelay = 0.9;
    }

    function launch(w) {
      var speed = clamp(w * 0.55, 250, 460);
      var angle = -Math.PI / 2 + (Math.random() * 0.7 - 0.35);
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
    }

    function syncSize(w, h) {
      var key = w + "x" + h;
      if (key === sizeKey) return false;
      sizeKey = key;
      paddleW = clamp(w * 0.2, 80, 150);
      paddleH = Math.max(10, Math.min(16, h * 0.03));
      paddleX = clamp(paddleX || (w - paddleW) / 2, 0, Math.max(0, w - paddleW));
      buildBricks(w, h);
      resetBall(w, h);
      return true;
    }

    api.setStatus("Playing");

    return {
      update: function (dt, input) {
        var w = api.width, h = api.height;
        syncSize(w, h);

        if (over || won) return;

        /* paddle control */
        var dir = 0;
        if (input.keys.has("arrowleft") || input.keys.has("a")) dir -= 1;
        if (input.keys.has("arrowright") || input.keys.has("d")) dir += 1;

        if (dir !== 0) {
          paddleX += dir * 820 * dt;
        } else if (input.px >= 0) {
          var target = input.px - paddleW / 2;
          paddleX += (target - paddleX) * Math.min(1, dt * 20);
        }
        paddleX = clamp(paddleX, 0, Math.max(0, w - paddleW));

        /* ball waits on the paddle briefly, or launches on tap / space */
        if (ball.vx === 0 && ball.vy === 0) {
          ball.x = paddleX + paddleW / 2;
          ball.y = h - 46 - ball.r;
          launchDelay -= dt;
          var tapped = input.taps.length > 0;
          var keyed = input.keys.has(" ") || input.keys.has("enter");
          if (launchDelay <= 0 || tapped || keyed) launch(w);
          return;
        }

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        /* walls */
        if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
        if (ball.x + ball.r > w) { ball.x = w - ball.r; ball.vx = -Math.abs(ball.vx); }
        if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }

        /* paddle */
        var py = h - 46;
        if (ball.vy > 0 &&
            ball.y + ball.r >= py &&
            ball.y - ball.r <= py + paddleH &&
            ball.x >= paddleX - ball.r &&
            ball.x <= paddleX + paddleW + ball.r) {
          var rel = (ball.x - (paddleX + paddleW / 2)) / (paddleW / 2);
          rel = clamp(rel, -1, 1);
          var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) * 1.015;
          speed = clamp(speed, 240, 760);
          var angle = rel * (Math.PI / 3);
          ball.vx = Math.sin(angle) * speed;
          ball.vy = -Math.cos(angle) * speed;
          ball.y = py - ball.r - 0.5;
        }

        /* bricks */
        for (var i = 0; i < bricks.length; i++) {
          var b = bricks[i];
          if (!b.alive) continue;
          if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w &&
              ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
            b.alive = false;
            score += 10;
            api.setScore(score);

            var overlapX = Math.min(ball.x + ball.r - b.x, b.x + b.w - (ball.x - ball.r));
            var overlapY = Math.min(ball.y + ball.r - b.y, b.y + b.h - (ball.y - ball.r));
            if (overlapX < overlapY) ball.vx = -ball.vx;
            else ball.vy = -ball.vy;
            break;
          }
        }

        /* lost ball */
        if (ball.y - ball.r > h) {
          lives -= 1;
          if (lives <= 0) {
            over = true;
            api.end("You scored " + score + " points. Press Play again to try for a higher score.");
            return;
          }
          resetBall(w, h);
        }

        /* cleared */
        var remaining = bricks.some(function (bb) { return bb.alive; });
        if (!remaining) {
          won = true;
          api.setStatus("Cleared!");
          api.end("Board cleared with " + score + " points and " + lives + " lives left. Impressive.");
        }
      },

      draw: function (ctx, w, h) {
        ctx.fillStyle = "#05050a";
        ctx.fillRect(0, 0, w, h);

        /* bricks */
        for (var i = 0; i < bricks.length; i++) {
          var b = bricks[i];
          if (!b.alive) continue;
          ctx.fillStyle = ROW_COLORS[b.row % ROW_COLORS.length];
          ctx.globalAlpha = 0.92;
          rr(ctx, b.x, b.y, b.w, b.h, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        /* paddle */
        ctx.save();
        ctx.shadowColor = "#8b5cf6";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#c4b5fd";
        rr(ctx, paddleX, h - 46, paddleW, paddleH, paddleH / 2);
        ctx.fill();
        ctx.restore();

        /* ball */
        ctx.save();
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 20;
        ctx.fillStyle = "#e0f2fe";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        /* lives */
        for (var l = 0; l < lives; l++) {
          ctx.fillStyle = "#f472b6";
          ctx.beginPath();
          ctx.arc(w - 16 - l * 16, 18, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
  }

  /* ---------------------------------------------------------------------
     GAME 2 — Star Dodger
     --------------------------------------------------------------------- */
  function createDodger(api) {
    var player = { x: 0, y: 0, r: 13, w: 26, h: 26 };
    var rocks = [];
    var spawnTimer = 0;
    var elapsed = 0;
    var score = 0;
    var over = false;
    var stars = [];

    for (var s = 0; s < 60; s++) {
      stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, sp: Math.random() * 0.4 + 0.1 });
    }

    api.setStatus("Playing");

    function spawn(w) {
      var size = 14 + Math.random() * 22;
      rocks.push({
        x: 20 + Math.random() * Math.max(1, w - 40),
        y: -40,
        r: size / 2,
        vy: 130 + Math.random() * 130 + elapsed * 6,
        drift: (Math.random() - 0.5) * 70
      });
    }

    return {
      update: function (dt, input) {
        var w = api.width, h = api.height;

        player.r = clamp(Math.min(w, h) * 0.03, 8, 18);
        player.w = player.r * 2;
        player.h = player.r * 2;
        player.y = h - 40;

        if (over) return;

        elapsed += dt;
        score = Math.floor(elapsed * 10);
        api.setScore(score);

        /* movement: keys or pointer */
        var dir = 0;
        if (input.keys.has("arrowleft") || input.keys.has("a")) dir -= 1;
        if (input.keys.has("arrowright") || input.keys.has("d")) dir += 1;

        if (dir !== 0) {
          player.x += dir * 460 * dt;
        } else if (input.px >= 0) {
          player.x += (input.px - player.x) * Math.min(1, dt * 16);
        }
        player.x = clamp(player.x, player.r + 4, w - player.r - 4);

        /* spawning */
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawn(w);
          spawnTimer = Math.max(0.18, 0.55 - elapsed * 0.012);
        }

        /* rocks */
        for (var i = rocks.length - 1; i >= 0; i--) {
          var r = rocks[i];
          r.y += r.vy * dt;
          r.x += r.drift * dt;
          if (r.x < r.r) { r.x = r.r; r.drift = Math.abs(r.drift); }
          if (r.x > w - r.r) { r.x = w - r.r; r.drift = -Math.abs(r.drift); }

          if (r.y - r.r > h + 30) { rocks.splice(i, 1); continue; }

          var dx = r.x - player.x;
          var dy = r.y - player.y;
          if (dx * dx + dy * dy < (r.r + player.r * 0.82) * (r.r + player.r * 0.82)) {
            over = true;
            api.end("You dodged for " + elapsed.toFixed(1) + " seconds and scored " + score + " points.");
            return;
          }
        }
      },

      draw: function (ctx, w, h) {
        ctx.fillStyle = "#05050a";
        ctx.fillRect(0, 0, w, h);

        /* stars */
        var t = elapsed;
        for (var i = 0; i < stars.length; i++) {
          var st = stars[i];
          var y = ((st.y + t * st.sp) % 1) * h;
          ctx.globalAlpha = 0.25 + st.r * 0.4;
          ctx.fillStyle = "#c7d2fe";
          ctx.beginPath();
          ctx.arc(st.x * w, y, st.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        /* rocks */
        for (var j = 0; j < rocks.length; j++) {
          var r = rocks[j];
          ctx.save();
          ctx.shadowColor = "#f472b6";
          ctx.shadowBlur = 14;
          ctx.fillStyle = "#9f1239";
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.beginPath();
          ctx.arc(r.x - r.r * 0.28, r.y - r.r * 0.3, r.r * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }

        /* player */
        ctx.save();
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 22;
        ctx.fillStyle = "#e0f2fe";
        ctx.beginPath();
        ctx.moveTo(player.x, player.y - player.r * 1.15);
        ctx.lineTo(player.x + player.r, player.y + player.r * 0.85);
        ctx.lineTo(player.x - player.r, player.y + player.r * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        text(ctx, elapsed.toFixed(1) + "s", w / 2, 22, 15, "rgba(236,236,245,0.75)");
      }
    };
  }

  /* ---------------------------------------------------------------------
     GAME 3 — Neon Serpent
     --------------------------------------------------------------------- */
  function createSnake(api) {
    var cell = 20, cols = 20, rows = 12;
    var ox = 0, oy = 0;
    var snake = [];
    var dir = { x: 1, y: 0 };
    var nextDir = { x: 1, y: 0 };
    var food = { x: 0, y: 0 };
    var stepTimer = 0;
    var stepInterval = 0.13;
    var score = 0;
    var over = false;
    var sizeKey = "";

    function layout(w, h) {
      cell = Math.max(12, Math.floor(Math.min(w, h) / 17));
      cols = Math.max(8, Math.floor(w / cell));
      rows = Math.max(6, Math.floor(h / cell));
      ox = (w - cols * cell) / 2;
      oy = (h - rows * cell) / 2;
    }

    function placeFood() {
      var tries = 0;
      do {
        food.x = Math.floor(Math.random() * cols);
        food.y = Math.floor(Math.random() * rows);
        tries++;
      } while (tries < 400 && snake.some(function (p) { return p.x === food.x && p.y === food.y; }));
    }

    function reset() {
      snake = [{ x: Math.floor(cols / 3), y: Math.floor(rows / 2) }];
      dir = { x: 1, y: 0 };
      nextDir = { x: 1, y: 0 };
      score = 0;
      stepTimer = 0;
      stepInterval = 0.13;
      over = false;
      api.setScore(0);
      placeFood();
    }

    function syncSize(w, h) {
      var key = w + "x" + h;
      if (key === sizeKey) return;
      sizeKey = key;
      layout(w, h);
      reset();
    }

    api.setStatus("Playing");
    layout(api.width, api.height);
    reset();

    return {
      update: function (dt, input) {
        syncSize(api.width, api.height);
        if (over) return;

        /* input */
        if (input.keys.has("arrowleft") || input.keys.has("a")) tryDir(-1, 0);
        if (input.keys.has("arrowright") || input.keys.has("d")) tryDir(1, 0);
        if (input.keys.has("arrowup") || input.keys.has("w")) tryDir(0, -1);
        if (input.keys.has("arrowdown") || input.keys.has("s")) tryDir(0, 1);

        for (var i = 0; i < input.swipes.length; i++) {
          var sw = input.swipes[i];
          if (sw === "left") tryDir(-1, 0);
          else if (sw === "right") tryDir(1, 0);
          else if (sw === "up") tryDir(0, -1);
          else if (sw === "down") tryDir(0, 1);
        }

        function tryDir(x, y) {
          if (x === -dir.x && y === -dir.y) return; // no 180° reversal
          nextDir = { x: x, y: y };
        }

        stepTimer += dt;
        if (stepTimer < stepInterval) return;
        stepTimer -= stepInterval;

        dir = nextDir;

        var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

        if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) {
          over = true;
          api.end("You hit the wall with a score of " + score + ".");
          return;
        }

        for (var s = 0; s < snake.length; s++) {
          if (snake[s].x === head.x && snake[s].y === head.y) {
            over = true;
            api.end("You bit your own tail at " + score + " points.");
            return;
          }
        }

        snake.unshift(head);

        if (head.x === food.x && head.y === food.y) {
          score += 10;
          api.setScore(score);
          stepInterval = Math.max(0.07, stepInterval - 0.0035);
          placeFood();
        } else {
          snake.pop();
        }
      },

      draw: function (ctx, w, h) {
        ctx.fillStyle = "#05050a";
        ctx.fillRect(0, 0, w, h);

        /* subtle grid */
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        ctx.lineWidth = 1;
        for (var c = 0; c <= cols; c++) {
          ctx.beginPath();
          ctx.moveTo(ox + c * cell, oy);
          ctx.lineTo(ox + c * cell, oy + rows * cell);
          ctx.stroke();
        }
        for (var r = 0; r <= rows; r++) {
          ctx.beginPath();
          ctx.moveTo(ox, oy + r * cell);
          ctx.lineTo(ox + cols * cell, oy + r * cell);
          ctx.stroke();
        }

        /* food */
        ctx.save();
        ctx.shadowColor = "#f472b6";
        ctx.shadowBlur = 16;
        ctx.fillStyle = "#f472b6";
        ctx.beginPath();
        ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        /* snake */
        for (var i = snake.length - 1; i >= 0; i--) {
          var p = snake[i];
          var ratio = i / Math.max(1, snake.length);
          ctx.fillStyle = i === 0 ? "#7dd3fc" : "rgba(34,211,238," + (0.9 - ratio * 0.55) + ")";
          rr(ctx, ox + p.x * cell + 1.5, oy + p.y * cell + 1.5, cell - 3, cell - 3, cell * 0.28);
          ctx.fill();
        }
      }
    };
  }

  /* ---------------------------------------------------------------------
     GAME 4 — Reflex Rush
     --------------------------------------------------------------------- */
  function createReflex(api) {
    var target = { x: 0, y: 0, r: 30, ttl: 0, maxTtl: 1.9 };
    var score = 0, misses = 0, hits = 0;
    var over = false;
    var spawnCooldown = 0.35;

    api.setStatus("Playing");

    function spawnTarget(w, h) {
      target.r = clamp(Math.min(w, h) * 0.075, 18, 44);
      var margin = target.r + 24;
      target.x = margin + Math.random() * Math.max(1, w - margin * 2);
      target.y = margin + 30 + Math.random() * Math.max(1, h - margin * 2 - 30);
      target.maxTtl = Math.max(0.75, 1.9 - hits * 0.06);
      target.ttl = target.maxTtl;
    }

    return {
      update: function (dt, input) {
        var w = api.width, h = api.height;
        if (over) return;

        if (target.ttl <= 0 && spawnCooldown <= 0) {
          spawnTarget(w, h);
        }

        if (target.ttl > 0) {
          target.ttl -= dt;

          /* taps */
          for (var i = 0; i < input.taps.length; i++) {
            var t = input.taps[i];
            var dx = t.x - target.x;
            var dy = t.y - target.y;
            if (dx * dx + dy * dy <= target.r * target.r) {
              hits++;
              score += 10 + Math.round(target.ttl * 20);
              api.setScore(score);
              target.ttl = 0;
              spawnCooldown = 0.28;
              return;
            }
          }

          if (target.ttl <= 0) {
            misses++;
            spawnCooldown = 0.5;
            if (misses >= 3) {
              over = true;
              api.end("Three misses. Final score: " + score + " with " + hits + " hits.");
            }
          }
        } else {
          spawnCooldown -= dt;
        }
      },

      draw: function (ctx, w, h) {
        ctx.fillStyle = "#05050a";
        ctx.fillRect(0, 0, w, h);

        /* misses indicator */
        for (var i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(w - 20 - i * 18, 20, 6, 0, Math.PI * 2);
          ctx.fillStyle = i < misses ? "#f87171" : "rgba(255,255,255,0.16)";
          ctx.fill();
        }

        if (target.ttl <= 0) {
          text(ctx, "Get ready…", w / 2, h / 2, Math.min(w, h) * 0.06, "rgba(236,236,245,0.55)");
          return;
        }

        var pct = clamp(target.ttl / target.maxTtl, 0, 1);

        /* outer ring shrinks as time runs out */
        ctx.strokeStyle = "rgba(251,191,36,0.35)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.r + 10, 0, Math.PI * 2 * pct);
        ctx.stroke();

        ctx.save();
        ctx.shadowColor = "#fbbf24";
        ctx.shadowBlur = 26;
        var grad = ctx.createRadialGradient(target.x, target.y, 2, target.x, target.y, target.r);
        grad.addColorStop(0, "#fde68a");
        grad.addColorStop(1, "#f59e0b");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        text(ctx, String(hits), w / 2, 22, 15, "rgba(236,236,245,0.7)");
      }
    };
  }

  /* ---------------------------------------------------------------------
     GAME 5 — Pixel Pong
     --------------------------------------------------------------------- */
  function createPong(api) {
    var playerY = 0, aiY = 0;
    var paddleH = 70, paddleW = 12;
    var ball = { x: 0, y: 0, r: 8, vx: 0, vy: 0, speed: 340 };
    var playerScore = 0, aiScore = 0;
    var serveDelay = 0.8;
    var over = false;
    var sizeKey = "";

    var WIN_SCORE = 7;

    function syncSize(w, h) {
      var key = w + "x" + h;
      if (key === sizeKey) return;
      sizeKey = key;
      paddleH = clamp(h * 0.2, 46, 100);
      paddleW = clamp(w * 0.014, 8, 14);
      playerY = (h - paddleH) / 2;
      aiY = (h - paddleH) / 2;
      ball.r = clamp(Math.min(w, h) * 0.017, 5, 9);
      resetBall(w, h, 1);
    }

    function resetBall(w, h, dirSign) {
      ball.x = w / 2;
      ball.y = h / 2;
      var angle = (Math.random() * 0.7 - 0.35);
      ball.speed = clamp(w * 0.5, 260, 480);
      ball.vx = Math.cos(angle) * ball.speed * (dirSign || 1);
      ball.vy = Math.sin(angle) * ball.speed;
      serveDelay = 0.8;
    }

    api.setStatus("Playing");

    return {
      update: function (dt, input) {
        var w = api.width, h = api.height;
        syncSize(w, h);
        if (over) return;

        /* player paddle */
        var dir = 0;
        if (input.keys.has("arrowup") || input.keys.has("w")) dir -= 1;
        if (input.keys.has("arrowdown") || input.keys.has("s")) dir += 1;

        if (dir !== 0) {
          playerY += dir * 520 * dt;
        } else if (input.py >= 0) {
          var targetY = input.py - paddleH / 2;
          playerY += (targetY - playerY) * Math.min(1, dt * 18);
        }
        playerY = clamp(playerY, 0, h - paddleH);

        /* AI paddle */
        var aiCenter = aiY + paddleH / 2;
        var aiSpeed = 300 + (playerScore + aiScore) * 18;
        var diff = ball.y - aiCenter;
        if (Math.abs(diff) > 6) {
          aiY += clamp(diff, -1, 1) * aiSpeed * dt;
        }
        aiY = clamp(aiY, 0, h - paddleH);

        /* serve pause */
        if (serveDelay > 0) {
          serveDelay -= dt;
          ball.x = w / 2;
          ball.y = h / 2;
          return;
        }

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        /* top / bottom */
        if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
        if (ball.y + ball.r > h) { ball.y = h - ball.r; ball.vy = -Math.abs(ball.vy); }

        /* player paddle (left) */
        var px = 18;
        if (ball.vx < 0 &&
            ball.x - ball.r <= px + paddleW &&
            ball.x - ball.r >= px - 4 &&
            ball.y >= playerY - ball.r &&
            ball.y <= playerY + paddleH + ball.r) {
          var rel = clamp((ball.y - (playerY + paddleH / 2)) / (paddleH / 2), -1, 1);
          ball.speed = clamp(ball.speed * 1.045, 260, 820);
          var ang = rel * (Math.PI / 3.4);
          ball.vx = Math.cos(ang) * ball.speed;
          ball.vy = Math.sin(ang) * ball.speed;
          ball.x = px + paddleW + ball.r + 1;
        }

        /* AI paddle (right) */
        var ax = w - 18 - paddleW;
        if (ball.vx > 0 &&
            ball.x + ball.r >= ax &&
            ball.x + ball.r <= ax + paddleW + 4 &&
            ball.y >= aiY - ball.r &&
            ball.y <= aiY + paddleH + ball.r) {
          var rel2 = clamp((ball.y - (aiY + paddleH / 2)) / (paddleH / 2), -1, 1);
          ball.speed = clamp(ball.speed * 1.045, 260, 820);
          var ang2 = rel2 * (Math.PI / 3.4);
          ball.vx = -Math.cos(ang2) * ball.speed;
          ball.vy = Math.sin(ang2) * ball.speed;
          ball.x = ax - ball.r - 1;
        }

        /* scoring */
        if (ball.x + ball.r < 0) {
          aiScore++;
          if (aiScore >= WIN_SCORE) {
            over = true;
            api.end("The computer won " + aiScore + "–" + playerScore + ". Press Play for a rematch.");
            return;
          }
          resetBall(w, h, 1);
        } else if (ball.x - ball.r > w) {
          playerScore++;
          api.setScore(playerScore);
          if (playerScore >= WIN_SCORE) {
            over = true;
            api.end("You won " + playerScore + "–" + aiScore + "! Well played.");
            return;
          }
          resetBall(w, h, -1);
        }
      },

      draw: function (ctx, w, h) {
        ctx.fillStyle = "#05050a";
        ctx.fillRect(0, 0, w, h);

        /* centre line */
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 14]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();
        ctx.setLineDash([]);

        text(ctx, String(playerScore), w / 2 - 46, 34, 26, "rgba(52,211,153,0.85)");
        text(ctx, String(aiScore), w / 2 + 46, 34, 26, "rgba(248,113,113,0.85)");

        /* paddles */
        ctx.save();
        ctx.shadowColor = "#34d399";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#6ee7b7";
        rr(ctx, 18, playerY, paddleW, paddleH, paddleW / 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.shadowColor = "#f87171";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#fca5a5";
        rr(ctx, w - 18 - paddleW, aiY, paddleW, paddleH, paddleW / 2);
        ctx.fill();
        ctx.restore();

        /* ball */
        ctx.save();
        ctx.shadowColor = "#e0f2fe";
        ctx.shadowBlur = 22;
        ctx.fillStyle = "#f8fafc";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
  }

  /* ---------------------------------------------------------------------
     GAME 6 — Mind Match
     --------------------------------------------------------------------- */
  function createMemory(api) {
    var SYMBOLS = ["\u25C6", "\u25CF", "\u25B2", "\u25A0", "\u2605", "\u2726", "\u2B22", "\u2B1F"];
    var PAIRS = 8;
    var cards = [];
    var flipped = [];
    var matched = 0;
    var moves = 0;
    var score = 0;
    var lockTimer = 0;
    var won = false;
    var over = false;
    var sizeKey = "";

    function shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }

    function reset() {
      var deck = [];
      for (var i = 0; i < PAIRS; i++) {
        deck.push({ sym: SYMBOLS[i], key: i });
        deck.push({ sym: SYMBOLS[i], key: i });
      }
      shuffle(deck);

      cards = deck.map(function (c) {
        return { sym: c.sym, key: c.key, revealed: false, done: false };
      });

      flipped = [];
      matched = 0;
      moves = 0;
      score = 0;
      lockTimer = 0;
      won = false;
      over = false;
      api.setScore(0);
    }

    function geometry(w, h) {
      var cols = 4, rows = 4;
      var pad = Math.max(6, Math.min(w, h) * 0.02);
      var availW = w - pad * (cols + 1);
      var availH = h - pad * (rows + 1) - 26;
      var cw = availW / cols;
      var ch = availH / rows;
      var size = Math.min(cw, ch);
      var gridW = size * cols + pad * (cols - 1);
      var gridH = size * rows + pad * (rows - 1);
      var ox = (w - gridW) / 2;
      var oy = (h - gridH) / 2 + 10;
      return { cols: cols, rows: rows, pad: pad, size: size, ox: ox, oy: oy };
    }

    function syncSize(w, h) {
      var key = w + "x" + h;
      if (key === sizeKey) return;
      sizeKey = key;
    }

    api.setStatus("Playing");
    reset();

    return {
      update: function (dt, input) {
        var w = api.width, h = api.height;
        syncSize(w, h);

        if (over || won) return;

        if (lockTimer > 0) {
          lockTimer -= dt;
          if (lockTimer <= 0) {
            /* hide the two non-matching cards */
            flipped.forEach(function (idx) {
              if (!cards[idx].done) cards[idx].revealed = false;
            });
            flipped = [];
          }
          return;
        }

        if (!input.taps.length) return;

        var g = geometry(w, h);
        var t = input.taps[0];

        var col = Math.floor((t.x - g.ox) / (g.size + g.pad));
        var row = Math.floor((t.y - g.oy) / (g.size + g.pad));

        if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return;

        /* ensure the tap is inside the card, not in the gutter */
        var cx = g.ox + col * (g.size + g.pad);
        var cy = g.oy + row * (g.size + g.pad);
        if (t.x < cx || t.x > cx + g.size || t.y < cy || t.y > cy + g.size) return;

        var idx = row * g.cols + col;
        var card = cards[idx];
        if (!card || card.done || card.revealed) return;

        card.revealed = true;
        flipped.push(idx);

        if (flipped.length === 2) {
          moves++;
          var a = cards[flipped[0]];
          var b = cards[flipped[1]];

          if (a.key === b.key) {
            a.done = true;
            b.done = true;
            matched++;
            score += 25;
            api.setScore(score);
            flipped = [];

            if (matched === PAIRS) {
              won = true;
              api.setStatus("Solved!");
              api.end("Solved in " + moves + " moves for " + score + " points. Excellent memory.");
            }
          } else {
            lockTimer = 0.75;
          }
        }
      },

      draw: function (ctx, w, h) {
        ctx.fillStyle = "#05050a";
        ctx.fillRect(0, 0, w, h);

        var g = geometry(w, h);

        for (var i = 0; i < cards.length; i++) {
          var card = cards[i];
          var col = i % g.cols;
          var row = Math.floor(i / g.cols);
          var x = g.ox + col * (g.size + g.pad);
          var y = g.oy + row * (g.size + g.pad);

          var show = card.revealed || card.done;

          ctx.save();
          if (show) {
            ctx.fillStyle = card.done ? "rgba(52,211,153,0.22)" : "rgba(139,92,246,0.26)";
            ctx.shadowColor = card.done ? "#34d399" : "#8b5cf6";
            ctx.shadowBlur = card.done ? 18 : 10;
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.055)";
          }
          rr(ctx, x, y, g.size, g.size, g.size * 0.16);
          ctx.fill();
          ctx.restore();

          ctx.strokeStyle = show ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)";
          ctx.lineWidth = 1.5;
          rr(ctx, x, y, g.size, g.size, g.size * 0.16);
          ctx.stroke();

          if (show) {
            text(ctx, card.sym, x + g.size / 2, y + g.size / 2 + 1, g.size * 0.42, "#f8fafc");
          } else {
            text(ctx, "?", x + g.size / 2, y + g.size / 2 + 1, g.size * 0.34, "rgba(167,167,194,0.55)");
          }
        }

        text(ctx, "Matches " + matched + " / " + PAIRS + "   \u2022   Moves " + moves,
          w / 2, h - 14, 13, "rgba(167,167,194,0.85)");
      }
    };
  }

  var BUILTIN_GAMES = {
    breakout: createBreakout,
    dodger: createDodger,
    snake: createSnake,
    reflex: createReflex,
    pong: createPong,
    memory: createMemory
  };

  /* ======================================================================
     14. Player controls wiring
     ====================================================================== */

  function wirePlayerControls() {
    els.playerBack.addEventListener("click", function () {
      engine.stop();
      navigate("library");
    });

    els.btnPlay.addEventListener("click", function () {
      var game = state.current;
      if (!game) return;

      if (game.sourceType === "builtin" && engine.isRunning()) {
        if (engine.isPaused()) {
          engine.resume();
          els.hudStatus.textContent = "Playing";
          els.btnPause.textContent = "Pause";
          hideOverlay();
        }
        return;
      }
      startCurrentGame();
    });

    els.btnPause.addEventListener("click", function () {
      if (!state.current || state.current.sourceType !== "builtin") return;
      if (!engine.isRunning()) return;

      if (engine.isPaused()) {
        engine.resume();
        els.hudStatus.textContent = "Playing";
        els.btnPause.textContent = "Pause";
        hideOverlay();
      } else {
        engine.pause();
        els.hudStatus.textContent = "Paused";
        els.btnPause.textContent = "Resume";
        showOverlay("Paused", "Your run is paused. Resume whenever you're ready.", "Resume", function () {
          engine.resume();
          els.hudStatus.textContent = "Playing";
          els.btnPause.textContent = "Pause";
          hideOverlay();
        });
      }
    });

    els.btnRestart.addEventListener("click", function () {
      if (!state.current || state.current.sourceType !== "builtin") return;
      startCurrentGame();
      els.btnPause.textContent = "Pause";
    });

    els.btnFullscreen.addEventListener("click", toggleFullscreen);

    els.btnFavorite.addEventListener("click", function () {
      if (state.current) toggleFavorite(state.current.id);
    });

    els.overlayAction.addEventListener("click", function () {
      if (typeof overlayAction === "function") overlayAction();
    });

    document.addEventListener("fullscreenchange", function () {
      var isFs = !!document.fullscreenElement;
      els.btnFullscreen.textContent = isFs ? "Exit Fullscreen" : "Fullscreen";
    });
  }

  function toggleFullscreen() {
    var stage = els.stage;
    if (!stage) return;

    var doc = document;
    var fsEl = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;

    if (fsEl) {
      var exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) exit.call(doc);
      return;
    }

    var request = stage.requestFullscreen || stage.webkitRequestFullscreen || stage.msRequestFullscreen;
    if (request) {
      var result = request.call(stage);
      if (result && typeof result.catch === "function") {
        result.catch(function () {
          toast("Fullscreen was blocked by the browser.", "error");
        });
      }
    } else {
      toast("Fullscreen is not supported in this browser.", "error");
    }
  }

  /* ======================================================================
     15. Global event wiring
     ====================================================================== */

  function wireGlobalEvents() {
    /* navigation buttons (header, footer, in-page) */
    document.addEventListener("click", function (ev) {
      var target = ev.target.closest ? ev.target.closest("[data-nav]") : null;
      if (!target) return;

      var view = target.dataset.nav;

      if (view === "categories") {
        engine.stop();
        navigate("home");
        var section = $("#categories-section");
        if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (view === "info") {
        engine.stop();
        navigate("info", { info: target.dataset.info || "about" });
        return;
      }

      if (view === "player") return;

      engine.stop();
      navigate(view);
    });

    /* mobile menu */
    els.menuToggle.addEventListener("click", function () {
      var open = els.nav.classList.toggle("is-open");
      els.menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    /* search */
    els.searchInput.addEventListener("input", function () {
      state.search = els.searchInput.value;
      els.searchClear.hidden = !state.search.length;

      if (state.view !== "library" && state.view !== "player" && state.search.trim()) {
        navigate("library", { keepScroll: true });
      }
      if (state.view === "library") renderLibrary();
    });

    els.searchForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (state.view !== "library") navigate("library");
      renderLibrary();
    });

    els.searchClear.addEventListener("click", function () {
      els.searchInput.value = "";
      state.search = "";
      els.searchClear.hidden = true;
      if (state.view === "library") renderLibrary();
      els.searchInput.focus();
    });

    /* sort */
    els.sortSelect.addEventListener("change", function () {
      state.sort = els.sortSelect.value;
      if (state.view === "library") renderLibrary();
    });

    /* recent */
    els.recentClear.addEventListener("click", clearRecent);

    /* hero CTA */
    els.heroPlay.addEventListener("click", function () {
      var game = state.games.find(function (g) { return g.featured; }) || state.games[0];
      if (game) openGame(game.id);
      else toast("The catalog is still loading.", "error");
    });

    /* escape closes the mobile menu */
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeMobileMenu();
    });

    /* close the menu when the viewport grows past the breakpoint */
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) closeMobileMenu();
    });
  }

  /* ======================================================================
     16. Boot
     ====================================================================== */

  function init() {
    cacheDom();

    if (els.year) els.year.textContent = String(new Date().getFullYear());

    wireGlobalEvents();
    wirePlayerControls();

    loadCatalog()
      .then(function (games) {
        if (!games.length) {
          setLibraryStatus("empty", "The catalog loaded but contains no published games.");
          els.librarySummary.textContent = "0 games";
          return;
        }

        setLibraryStatus(null, "");

        renderCategoryChips();
        renderHome();
        renderLibrary();
        renderFavorites();
        renderRecent();

        if (els.searchInput) els.searchInput.disabled = false;
      })
      .catch(function (err) {
        var isFileProtocol = window.location.protocol === "file:";
        var message = isFileProtocol
          ? "games.json could not be loaded because this page was opened directly from disk. Serve the folder over HTTP (for example: python -m http.server) and reload."
          : "games.json could not be loaded. " + (err && err.message ? err.message : "");

        setLibraryStatus("error", message);
        if (els.librarySummary) els.librarySummary.textContent = "Catalog unavailable";
        if (els.featuredMount) {
          els.featuredMount.textContent = "";
          var block = el("div", "state-block is-error");
          block.appendChild(el("h2", null, "Catalog unavailable"));
          block.appendChild(el("p", null, message));
          els.featuredMount.appendChild(block);
        }
        if (els.statGames) els.statGames.textContent = "0";
        if (els.statCategories) els.statCategories.textContent = "0";
        toast("Game catalog failed to load.", "error");
      });

    navigate("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();