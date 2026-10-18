/* =========================================================
   AnimeVerse — script.js  (playback-source bug fix)
   Single-file frontend: AniList GraphQL + Jikan fallback,
   hash routing, search, filters, details, player, favorites,
   localStorage, skeletons, error handling.

   FIX: Removed the global DEMO_STREAM_URL (which played the
   same Mux test stream / Big Buck Bunny for every anime).
   Playback now uses VIDEO_SOURCES[animeId][episodeNumber]
   with strict anime/episode validation and stale-request
   protection.
   ========================================================= */

(() => {
  "use strict";

  // -------------------------------------------------------
  // CONFIG
  // -------------------------------------------------------
  const ANILIST_URL = "https://graphql.anilist.co";
  const JIKAN_BASE = "https://api.jikan.moe/v4";
  const CACHE_PREFIX = "animeverse_cache_";
  const FAVORITES_KEY = "animeverse_favorites";
  const HISTORY_KEY = "animeverse_recent";
  const SEARCH_HISTORY_KEY = "animeverse_search_history";
  const PROGRESS_KEY = "animeverse_progress";
  const CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  const PAGE_SIZE = 20;
  const MAX_RECENT = 12;

  // -------------------------------------------------------
  // AUTHORIZED VIDEO SOURCE MAP  (per anime, per episode)
  // -------------------------------------------------------
  // Structure:
  //   VIDEO_SOURCES[animeId][episodeNumber] = {
  //     url:      string,  // licensed, authorized video URL (mp4 or m3u8)
  //     provider: string,  // where the stream comes from (for display)
  //     language: string,  // optional: "ja", "en", "hi", etc.
  //   }
  //
  // Rules:
  //  - Only add URLs you have the legal right to embed.
  //  - Do NOT guess, scrape, or re-host copyrighted URLs.
  //  - Do NOT leave a shared placeholder video here.
  //  - If an anime/episode has no entry, the player shows a clear
  //    "No authorized stream configured" notice for that specific
  //    anime and episode — never an unrelated video.
  //
  // Example (DO NOT uncomment until you have real licensed URLs):
  //
  // VIDEO_SOURCES["16498"] = {
  //   1: { url: "https://licensed.example/aot-s1e1.m3u8", provider: "MyProvider", language: "ja" },
  //   2: { url: "https://licensed.example/aot-s1e2.m3u8", provider: "MyProvider", language: "ja" },
  // };
  //
  const VIDEO_SOURCES = Object.create(null);

  /**
   * Strict lookup. Returns a source object that is guaranteed
   * to belong to the requested anime ID and episode, or null.
   */
  function getVideoSource(animeId, episodeNumber) {
    if (animeId === null || animeId === undefined) return null;
    const animeKey = String(animeId);
    const byAnime = VIDEO_SOURCES[animeKey];
    if (!byAnime) return null;

    const epKey = String(episodeNumber || 1);
    const source = byAnime[epKey];
    if (!source) return null;
    if (typeof source.url !== "string" || !source.url.trim()) return null;

    // Guard: if a source carries an explicit animeId, it must match.
    if (source.animeId !== undefined && String(source.animeId) !== animeKey) {
      console.error("Source animeId mismatch — refusing to play.", {
        requested: animeKey,
        declared: source.animeId
      });
      return null;
    }

    return {
      animeId: animeKey,
      episodeNumber: Number(epKey),
      url: source.url.trim(),
      provider: typeof source.provider === "string" ? source.provider : "Unknown provider",
      language: typeof source.language === "string" ? source.language : ""
    };
  }

  // -------------------------------------------------------
  // STATE
  // -------------------------------------------------------
  const state = {
    currentPage: "home",
    browsePage: 1,
    browseHasNext: false,
    browseFilters: {
      genre: "",
      type: "",
      year: "",
      status: "",
      sort: "POPULARITY_DESC"
    },
    searchTerm: "",
    searchController: null,
    currentAnimeId: null,
    currentPlayerAnimeId: null,
    currentSource: null,       // { animeId, episodeNumber } — currently loaded in <video>
    homeLoaded: false,
    genresLoaded: false,
    lastUpdated: null,
    hlsInstance: null
  };

  // Token counters — invalidate stale async responses.
  let playerRequestToken = 0;
  let detailsRequestToken = 0;

  // -------------------------------------------------------
  // DOM HELPERS
  // -------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value !== null && value !== undefined) {
        node.setAttribute(key, String(value));
      }
    });
    children.forEach((child) => {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  };

  const safeText = (value, fallback = "") =>
    (typeof value === "string" && value.trim()) ? value.trim() : fallback;

  const safeNumber = (value) =>
    (typeof value === "number" && Number.isFinite(value)) ? value : null;

  // -------------------------------------------------------
  // TOAST
  // -------------------------------------------------------
  let toastTimer = null;
  function showToast(message, type = "info") {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  // -------------------------------------------------------
  // LOCAL STORAGE
  // -------------------------------------------------------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------
  // CACHE
  // -------------------------------------------------------
  const memCache = new Map();

  function cacheGet(key) {
    if (memCache.has(key)) {
      const entry = memCache.get(key);
      if (Date.now() - entry.time < CACHE_TTL) return entry.data;
      memCache.delete(key);
    }
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.time < CACHE_TTL) {
        memCache.set(key, entry);
        return entry.data;
      }
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch { /* ignore */ }
    return null;
  }

  function cacheSet(key, data) {
    const entry = { time: Date.now(), data };
    memCache.set(key, entry);
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch { /* ignore quota */ }
  }

  // -------------------------------------------------------
  // ANILIST GRAPHQL
  // -------------------------------------------------------
  const MEDIA_FIELDS = `
    id
    idMal
    title { romaji english native }
    synonyms
    description(asHtml: false)
    coverImage { extraLarge large medium color }
    bannerImage
    format
    status
    episodes
    duration
    startDate { year month day }
    endDate { year month day }
    season
    seasonYear
    averageScore
    meanScore
    popularity
    favourites
    genres
    studios(isMain: true) { nodes { name } }
    trailer { id site }
    relations {
      edges {
        relationType
        node { id title { romaji english } coverImage { large } format status }
      }
    }
    recommendations(perPage: 6, sort: RATING_DESC) {
      nodes {
        mediaRecommendation {
          id
          title { romaji english }
          coverImage { large }
          format
          status
          averageScore
          episodes
          seasonYear
        }
      }
    }
  `;

  async function fetchGraphQL(query, variables = {}) {
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables })
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("Rate limit reached. Please wait a moment and try again.");
      throw new Error(`AniList request failed (HTTP ${res.status}).`);
    }

    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors[0].message || "AniList returned an error.");
    }
    return json.data;
  }

  // -------------------------------------------------------
  // JIKAN FALLBACK
  // -------------------------------------------------------
  async function jikanGet(path) {
    const res = await fetch(`${JIKAN_BASE}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Jikan request failed (HTTP ${res.status}).`);
    return res.json();
  }

  function mapJikanAnime(item) {
    if (!item) return null;
    return {
      id: item.mal_id,
      idMal: item.mal_id,
      title: {
        romaji: item.title || "",
        english: item.title_english || item.title || "",
        native: item.title_japanese || ""
      },
      synonyms: item.titles?.map((t) => t.title).filter(Boolean) || [],
      description: item.synopsis || "",
      coverImage: {
        extraLarge: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || "",
        large: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || "",
        medium: item.images?.jpg?.image_url || "",
        color: null
      },
      bannerImage: null,
      format: (item.type || "").toUpperCase(),
      status: item.status === "Currently Airing" ? "RELEASING"
        : item.status === "Finished Airing" ? "FINISHED"
        : item.status === "Not yet aired" ? "NOT_YET_RELEASED" : "FINISHED",
      episodes: item.episodes || null,
      duration: item.duration ? parseInt(item.duration, 10) : null,
      startDate: { year: item.year || null, month: null, day: null },
      seasonYear: item.year || null,
      averageScore: item.score ? Math.round(item.score * 10) : null,
      popularity: item.members || null,
      favourites: item.favorites || null,
      genres: item.genres?.map((g) => g.name) || [],
      studios: { nodes: item.studios?.map((s) => ({ name: s.name })) || [] },
      trailer: null,
      relations: { edges: [] },
      recommendations: { nodes: [] }
    };
  }

  // -------------------------------------------------------
  // FALLBACK SAMPLE DATA
  // -------------------------------------------------------
  const FALLBACK_ANIME = [
    {
      id: 16498, title: { romaji: "Shingeki no Kyojin", english: "Attack on Titan" },
      coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-C6FPmWm59CyP.jpg" },
      bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-8jpFCOcDmneX.jpg",
      format: "TV", status: "FINISHED", episodes: 25, seasonYear: 2013, averageScore: 85,
      genres: ["Action", "Drama", "Fantasy"],
      description: "Several hundred years ago, humans were nearly exterminated by titans.",
      studios: { nodes: [{ name: "Wit Studio" }] }
    },
    {
      id: 21, title: { romaji: "One Piece", english: "One Piece" },
      coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-ELSYtLzLpJ9z.png" },
      bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJmZqs.jpg",
      format: "TV", status: "RELEASING", episodes: null, seasonYear: 1999, averageScore: 88,
      genres: ["Action", "Adventure", "Comedy"],
      description: "Gol D. Roger was known as the Pirate King.",
      studios: { nodes: [{ name: "Toei Animation" }] }
    },
    {
      id: 20, title: { romaji: "Naruto", english: "Naruto" },
      coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20-XP5KtC0n1j0y.jpg" },
      bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/20-H4w3G5Kq0l7N.jpg",
      format: "TV", status: "FINISHED", episodes: 220, seasonYear: 2002, averageScore: 79,
      genres: ["Action", "Adventure", "Martial Arts"],
      description: "Naruto Uzumaki, a hyperactive and knuckle-headed ninja.",
      studios: { nodes: [{ name: "Pierrot" }] }
    },
    {
      id: 11061, title: { romaji: "Hunter x Hunter (2011)", english: "Hunter x Hunter" },
      coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx11061-y5g5gKz9l6Xq.jpg" },
      format: "TV", status: "FINISHED", episodes: 148, seasonYear: 2011, averageScore: 89,
      genres: ["Action", "Adventure", "Fantasy"],
      description: "Gon Freecss discovers his father is a legendary Hunter.",
      studios: { nodes: [{ name: "Madhouse" }] }
    },
    {
      id: 101922, title: { romaji: "Kimetsu no Yaiba", english: "Demon Slayer" },
      coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-PEn1CTc93RWS.jpg" },
      bannerImage: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922-R4z0m6q3yL8d.jpg",
      format: "TV", status: "RELEASING", episodes: null, seasonYear: 2019, averageScore: 84,
      genres: ["Action", "Supernatural", "Historical"],
      description: "Tanjiro Kamado's family is slaughtered by demons.",
      studios: { nodes: [{ name: "ufotable" }] }
    },
    {
      id: 108465, title: { romaji: "Jujutsu Kaisen", english: "Jujutsu Kaisen" },
      coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-bbBWj4pEFseh.jpg" },
      format: "TV", status: "FINISHED", episodes: 24, seasonYear: 2020, averageScore: 84,
      genres: ["Action", "Supernatural", "School"],
      description: "Yuji Itadori swallows a cursed finger and joins a secret school.",
      studios: { nodes: [{ name: "MAPPA" }] }
    }
  ];

  // -------------------------------------------------------
  // FAVORITES
  // -------------------------------------------------------
  function getFavorites() {
    return readJSON(FAVORITES_KEY, []);
  }

  function isFavorite(id) {
    return getFavorites().some((a) => Number(a.id) === Number(id));
  }

  function toggleFavorite(anime) {
    const favorites = getFavorites();
    const idx = favorites.findIndex((a) => Number(a.id) === Number(anime.id));
    if (idx >= 0) {
      favorites.splice(idx, 1);
      showToast("Removed from favorites.", "info");
    } else {
      favorites.push(compactAnime(anime));
      showToast("Added to favorites.", "success");
    }
    writeJSON(FAVORITES_KEY, favorites);
    refreshFavoriteButtons();
    if (state.currentPage === "favorites") renderFavoritesPage();
  }

  function compactAnime(anime) {
    return {
      id: anime.id,
      title: anime.title,
      coverImage: anime.coverImage,
      format: anime.format,
      status: anime.status,
      episodes: anime.episodes,
      seasonYear: anime.seasonYear,
      averageScore: anime.averageScore
    };
  }

  function refreshFavoriteButtons() {
    $$(".card-fav-btn").forEach((btn) => {
      const id = Number(btn.dataset.id);
      const fav = isFavorite(id);
      btn.classList.toggle("is-fav", fav);
      btn.setAttribute("aria-label", fav ? "Remove from favorites" : "Add to favorites");
      btn.textContent = fav ? "♥" : "♡";
    });
  }

  // -------------------------------------------------------
  // RECENTLY VIEWED & PROGRESS
  // -------------------------------------------------------
  function pushRecent(anime) {
    const recent = readJSON(HISTORY_KEY, []).filter((a) => Number(a.id) !== Number(anime.id));
    recent.unshift(compactAnime(anime));
    writeJSON(HISTORY_KEY, recent.slice(0, MAX_RECENT));
  }

  function getProgress(id) {
    const all = readJSON(PROGRESS_KEY, {});
    return all[String(id)] || null;
  }

  function saveProgress(id, currentTime, duration) {
    if (!duration || duration <= 0) return;
    const all = readJSON(PROGRESS_KEY, {});
    all[String(id)] = { currentTime, duration, updatedAt: Date.now() };
    writeJSON(PROGRESS_KEY, all);
  }

  // -------------------------------------------------------
  // NORMALIZE ANIME
  // -------------------------------------------------------
  function normalizeAnime(raw) {
    if (!raw) return null;
    const title = raw.title || {};
    return {
      id: raw.id,
      idMal: raw.idMal,
      title: {
        romaji: safeText(title.romaji || title.english || title.native, "Unknown title"),
        english: safeText(title.english || title.romaji || title.native, ""),
        native: safeText(title.native, "")
      },
      synonyms: Array.isArray(raw.synonyms) ? raw.synonyms.filter(Boolean) : [],
      description: safeText(raw.description, ""),
      coverImage: {
        extraLarge: raw.coverImage?.extraLarge || raw.coverImage?.large || raw.coverImage?.medium || "",
        large: raw.coverImage?.large || raw.coverImage?.extraLarge || "",
        medium: raw.coverImage?.medium || "",
        color: raw.coverImage?.color || null
      },
      bannerImage: raw.bannerImage || "",
      format: safeText(raw.format, "UNKNOWN"),
      status: safeText(raw.status, "UNKNOWN"),
      episodes: safeNumber(raw.episodes),
      duration: safeNumber(raw.duration),
      startDate: raw.startDate || null,
      seasonYear: safeNumber(raw.seasonYear || raw.startDate?.year),
      averageScore: safeNumber(raw.averageScore),
      meanScore: safeNumber(raw.meanScore),
      popularity: safeNumber(raw.popularity),
      favourites: safeNumber(raw.favourites),
      genres: Array.isArray(raw.genres) ? raw.genres.filter(Boolean) : [],
      studios: Array.isArray(raw.studios?.nodes) ? raw.studios.nodes.map((s) => s.name).filter(Boolean) : [],
      trailer: raw.trailer || null,
      relations: raw.relations?.edges || [],
      recommendations: raw.recommendations?.nodes || []
    };
  }

  // -------------------------------------------------------
  // CARD RENDERER
  // -------------------------------------------------------
  function createAnimeCard(anime, options = {}) {
    if (!anime) return null;
    const { showLangNote = false } = options;

    const card = el("article", { className: "anime-card", tabIndex: "0" });
    card.dataset.id = String(anime.id);

    const posterWrap = el("div", { className: "card-poster-wrap" });

    const img = el("img", {
      className: "card-poster",
      src: anime.coverImage.extraLarge || anime.coverImage.large || "",
      alt: `Poster for ${anime.title.romaji}`,
      loading: "lazy",
      decoding: "async"
    });
    img.addEventListener("error", () => {
      img.replaceWith(el("div", { className: "card-poster-fallback" }, "No poster available"));
    });

    const favBtn = el("button", {
      type: "button",
      className: `card-fav-btn${isFavorite(anime.id) ? " is-fav" : ""}`,
      "aria-label": isFavorite(anime.id) ? "Remove from favorites" : "Add to favorites",
      title: "Toggle favorite"
    }, isFavorite(anime.id) ? "♥" : "♡");
    favBtn.dataset.id = String(anime.id);
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(anime);
    });

    posterWrap.append(img, favBtn);

    if (anime.averageScore) {
      posterWrap.appendChild(
        el("span", { className: "card-score" }, `★ ${(anime.averageScore / 10).toFixed(1)}`)
      );
    }

    const metaParts = [];
    if (anime.format) metaParts.push(anime.format);
    if (anime.seasonYear) metaParts.push(String(anime.seasonYear));
    if (anime.episodes) metaParts.push(`${anime.episodes} ep`);

    const body = el("div", { className: "card-body" },
      el("h3", { className: "card-title" }, anime.title.romaji),
      el("div", { className: "card-meta" },
        ...metaParts.map((p, i) =>
          el("span", { className: i === 0 ? "type-badge" : "" }, p)
        )
      )
    );

    if (showLangNote) {
      body.appendChild(
        el("span", { className: "card-lang-note" }, "Dub language not verified by API")
      );
    }

    card.append(posterWrap, body);

    card.addEventListener("click", () => navigateToAnime(anime.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigateToAnime(anime.id);
      }
    });

    return card;
  }

  function renderGrid(container, animeList, options = {}) {
    if (!container) return;
    container.innerHTML = "";
    container.classList.remove("skeleton-grid");
    container.removeAttribute("aria-busy");

    if (!animeList || animeList.length === 0) {
      container.appendChild(
        el("div", { className: "empty-state", style: "grid-column:1/-1" },
          el("div", { className: "empty-icon" }, "⌕"),
          el("h2", {}, "Nothing to show"),
          el("p", {}, "Try adjusting your filters or refresh the page.")
        )
      );
      return;
    }

    const frag = document.createDocumentFragment();
    animeList.forEach((anime) => {
      const card = createAnimeCard(anime, options);
      if (card) frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  // -------------------------------------------------------
  // SKELETONS
  // -------------------------------------------------------
  function showSkeletons(container, count = 10) {
    if (!container) return;
    container.innerHTML = "";
    container.classList.add("skeleton-grid");
    container.setAttribute("aria-busy", "true");
    for (let i = 0; i < count; i++) {
      container.appendChild(el("div", { className: "skeleton-card", "aria-hidden": "true" }));
    }
  }

  // -------------------------------------------------------
  // QUERY BUILDERS
  // -------------------------------------------------------
  function buildListQuery({ sort, format, status, genre, year, search }) {
    const vars = [];
    const args = ["type: ANIME", "isAdult: false"];

    if (sort) { vars.push(`$sort: [MediaSort]`); args.push("sort: $sort"); }
    if (format) { vars.push(`$format: MediaFormat`); args.push("format: $format"); }
    if (status) { vars.push(`$status: MediaStatus`); args.push("status: $status"); }
    if (genre) { vars.push(`$genre: String`); args.push("genre_in: [$genre]"); }
    if (year) { vars.push(`$year: Int`); args.push("seasonYear: $year"); }
    if (search) { vars.push(`$search: String`); args.push("search: $search"); }

    const varDefs = vars.length ? `(${vars.join(", ")})` : "";
    const query = `
      query${varDefs} {
        Page(page: 1, perPage: ${PAGE_SIZE}) {
          pageInfo { hasNextPage total }
          media(${args.join(", ")}) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;

    const variables = {};
    if (sort) variables.sort = [sort];
    if (format) variables.format = format;
    if (status) variables.status = status;
    if (genre) variables.genre = genre;
    if (year) variables.year = Number(year);
    if (search) variables.search = search;

    return { query, variables };
  }

  async function fetchAnimeList(options = {}) {
    const cacheKey = "list_" + JSON.stringify(options);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const { query, variables } = buildListQuery(options);
      const data = await fetchGraphQL(query, variables);
      const list = (data?.Page?.media || []).map(normalizeAnime).filter(Boolean);
      cacheSet(cacheKey, list);
      return list;
    } catch (err) {
      console.warn("AniList list failed, trying Jikan:", err.message);
      try {
        const params = new URLSearchParams();
        if (options.search) params.set("q", options.search);
        if (options.format) params.set("type", mapFormatToJikan(options.format));
        if (options.status) params.set("status", mapStatusToJikan(options.status));
        if (options.year) params.set("start_date", `${options.year}-01-01`);
        params.set("order_by", mapSortToJikan(options.sort));
        params.set("sort", "desc");
        params.set("limit", String(PAGE_SIZE));
        params.set("sfw", "true");

        const json = await jikanGet(`/anime?${params.toString()}`);
        const list = (json.data || []).map(mapJikanAnime).filter(Boolean);
        cacheSet(cacheKey, list);
        return list;
      } catch (jikanErr) {
        console.warn("Jikan fallback failed:", jikanErr.message);
        return null;
      }
    }
  }

  function mapFormatToJikan(format) {
    const map = { TV: "tv", MOVIE: "movie", OVA: "ova", ONA: "ona", SPECIAL: "special", MUSIC: "music" };
    return map[format] || "";
  }
  function mapStatusToJikan(status) {
    const map = { RELEASING: "airing", FINISHED: "complete", NOT_YET_RELEASED: "upcoming" };
    return map[status] || "";
  }
  function mapSortToJikan(sort) {
    const map = {
      POPULARITY_DESC: "members",
      SCORE_DESC: "score",
      START_DATE_DESC: "start_date",
      TITLE_ROMAJI: "title"
    };
    return map[sort] || "members";
  }

  // -------------------------------------------------------
  // GENRES
  // -------------------------------------------------------
  const GENRES = [
    "Action", "Adventure", "Fantasy", "Isekai", "Romance", "Comedy",
    "Drama", "Thriller", "Mystery", "Horror", "Sci-Fi", "Sports",
    "Slice of Life", "Supernatural", "Martial Arts", "Mecha", "Music",
    "Psychological", "Historical", "Superhero"
  ];

  function renderGenreChips(container) {
    if (!container) return;
    container.innerHTML = "";
    container.classList.remove("skeleton-grid");
    container.removeAttribute("aria-busy");

    GENRES.forEach((genre) => {
      const chip = el("button", {
        type: "button",
        className: "genre-chip",
        "aria-label": `Browse ${genre} anime`
      },
        el("span", {}, genre),
        el("span", { className: "arrow", "aria-hidden": "true" }, "→")
      );
      chip.addEventListener("click", () => {
        state.browseFilters.genre = genre;
        const g = $("#browse-genre");
        if (g) g.value = genre;
        navigateTo("browse");
        loadBrowsePage();
      });
      container.appendChild(chip);
    });
  }

  // -------------------------------------------------------
  // HERO
  // -------------------------------------------------------
  function renderHero(anime) {
    const hero = $("#hero-banner");
    if (!hero) return;
    hero.classList.remove("skeleton-hero");
    hero.innerHTML = "";

    if (!anime) {
      hero.appendChild(
        el("div", { className: "empty-state", style: "width:100%" },
          el("h2", {}, "Unable to load featured anime"),
          el("p", {}, "The metadata API may be temporarily unavailable. Fallback data is used elsewhere.")
        )
      );
      return;
    }

    const bg = anime.bannerImage || anime.coverImage.extraLarge;
    if (bg) {
      const bgImg = el("img", {
        className: "hero-bg", src: bg, alt: "", "aria-hidden": "true", loading: "eager"
      });
      bgImg.addEventListener("error", () => bgImg.remove());
      hero.appendChild(bgImg);
    }

    hero.appendChild(el("div", { className: "hero-overlay", "aria-hidden": "true" }));

    const content = el("div", { className: "hero-content" });

    if (anime.coverImage.large) {
      const poster = el("img", {
        className: "hero-poster",
        src: anime.coverImage.extraLarge || anime.coverImage.large,
        alt: `Poster for ${anime.title.romaji}`,
        loading: "eager"
      });
      poster.addEventListener("error", () => poster.remove());
      content.appendChild(poster);
    }

    const info = el("div", { className: "hero-info" });
    info.appendChild(el("span", { className: "hero-eyebrow" }, "Featured Anime"));
    info.appendChild(el("h2", { className: "hero-title" }, anime.title.romaji));

    const meta = el("div", { className: "hero-meta" });
    if (anime.averageScore) {
      meta.appendChild(el("span", { className: "rating" }, `★ ${(anime.averageScore / 10).toFixed(1)}`));
    }
    if (anime.format) meta.appendChild(el("span", {}, anime.format));
    if (anime.seasonYear) meta.appendChild(el("span", {}, String(anime.seasonYear)));
    if (anime.episodes) meta.appendChild(el("span", {}, `${anime.episodes} episodes`));
    if (anime.status) {
      const statusText = anime.status === "RELEASING" ? "Airing"
        : anime.status === "FINISHED" ? "Completed"
        : anime.status === "NOT_YET_RELEASED" ? "Upcoming" : anime.status;
      meta.appendChild(el("span", {}, statusText));
    }
    info.appendChild(meta);

    if (anime.description) {
      const synopsis = anime.description.replace(/<[^>]*>/g, "").trim();
      info.appendChild(el("p", { className: "hero-synopsis" },
        synopsis.slice(0, 320) + (synopsis.length > 320 ? "…" : "")));
    }

    const actions = el("div", { className: "hero-actions" });
    const detailsBtn = el("button", { type: "button", className: "btn btn-primary" }, "View details");
    detailsBtn.addEventListener("click", () => navigateToAnime(anime.id));

    const favBtn = el("button", { type: "button", className: "btn btn-ghost" },
      isFavorite(anime.id) ? "♥ Favorited" : "♡ Add to favorites");
    favBtn.addEventListener("click", () => {
      toggleFavorite(anime);
      favBtn.textContent = isFavorite(anime.id) ? "♥ Favorited" : "♡ Add to favorites";
    });

    actions.append(detailsBtn, favBtn);
    info.appendChild(actions);
    content.appendChild(info);
    hero.appendChild(content);
  }

  // -------------------------------------------------------
  // HOME
  // -------------------------------------------------------
  async function loadHomePage(force = false) {
    if (state.homeLoaded && !force) return;
    state.homeLoaded = true;

    const sections = [
      { id: "trending-grid", options: { sort: "TRENDING_DESC" } },
      { id: "popular-grid", options: { sort: "POPULARITY_DESC" } },
      { id: "recent-grid", options: { sort: "START_DATE_DESC" } },
      { id: "airing-grid", options: { status: "RELEASING", sort: "POPULARITY_DESC" } },
      { id: "upcoming-grid", options: { status: "NOT_YET_RELEASED", sort: "POPULARITY_DESC" } },
      { id: "top-rated-grid", options: { sort: "SCORE_DESC" } },
      { id: "movies-home-grid", options: { format: "MOVIE", sort: "POPULARITY_DESC" } }
    ];

    sections.forEach(({ id }) => showSkeletons($(`#${id}`)));

    const heroList = await fetchAnimeList({ sort: "TRENDING_DESC" });
    const heroAnime = normalizeAnime(heroList?.[0] || FALLBACK_ANIME[0]);
    renderHero(heroAnime || FALLBACK_ANIME[0]);

    for (const { id, options } of sections) {
      const container = $(`#${id}`);
      if (!container) continue;
      let list = await fetchAnimeList(options);
      if (!list || list.length === 0) {
        list = FALLBACK_ANIME.map(normalizeAnime).filter(Boolean);
      }
      renderGrid(container, list);
    }

    renderGenreChips($("#genre-home-grid"));
    renderContinueWatching();

    state.lastUpdated = new Date();
    const lu = $("#last-updated-home");
    if (lu) lu.textContent = `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function renderContinueWatching() {
    const wrap = $("#continue-watching-wrap");
    const grid = $("#continue-grid");
    if (!wrap || !grid) return;

    const recent = readJSON(HISTORY_KEY, []);
    if (!recent.length) { wrap.hidden = true; return; }

    wrap.hidden = false;
    grid.innerHTML = "";
    recent.slice(0, 6).forEach((anime) => {
      const card = createAnimeCard(normalizeAnime(anime) || anime);
      if (card) grid.appendChild(card);
    });
  }

  // -------------------------------------------------------
  // BROWSE
  // -------------------------------------------------------
  function populateBrowseFilters() {
    const genreSelect = $("#browse-genre");
    if (genreSelect && genreSelect.options.length <= 1) {
      GENRES.forEach((g) => genreSelect.appendChild(el("option", { value: g }, g)));
    }

    const yearSelect = $("#browse-year");
    if (yearSelect && yearSelect.options.length <= 1) {
      const currentYear = new Date().getFullYear();
      for (let y = currentYear + 1; y >= 1960; y--) {
        yearSelect.appendChild(el("option", { value: String(y) }, String(y)));
      }
    }
  }

  async function loadBrowsePage() {
    populateBrowseFilters();
    showSkeletons($("#browse-grid"));
    $("#browse-load-more-wrap").hidden = true;

    let list = await fetchAnimeList({ ...state.browseFilters });
    const statusBar = $("#browse-status-bar");

    if (!list || list.length === 0) {
      if (statusBar) {
        statusBar.hidden = false;
        statusBar.className = "status-bar error";
        statusBar.textContent = "The anime API returned no results or is unavailable. Showing fallback sample data.";
      }
      list = FALLBACK_ANIME.map(normalizeAnime).filter(Boolean);
    } else if (statusBar) {
      statusBar.hidden = true;
    }

    renderGrid($("#browse-grid"), list);
  }

  function handleBrowseFilterSubmit(e) {
    e.preventDefault();
    state.browseFilters = {
      genre: $("#browse-genre").value,
      type: $("#browse-type").value,
      year: $("#browse-year").value,
      status: $("#browse-status").value,
      sort: $("#browse-sort").value
    };
    loadBrowsePage();
  }

  function resetBrowseFilters() {
    const form = $("#browse-filters-form");
    if (form) form.reset();
    state.browseFilters = { genre: "", type: "", year: "", status: "", sort: "POPULARITY_DESC" };
    loadBrowsePage();
  }

  // -------------------------------------------------------
  // GENRES / MOVIES / HINDI / LATEST
  // -------------------------------------------------------
  function loadGenresPage() {
    renderGenreChips($("#genre-list-grid"));
    state.genresLoaded = true;
  }

  async function loadGenreResults(genre) {
    const title = $("#genre-results-title");
    const grid = $("#genre-results-grid");
    if (!title || !grid) return;

    title.hidden = false;
    title.textContent = `${genre} Anime`;
    showSkeletons(grid);

    let list = await fetchAnimeList({ genre, sort: "POPULARITY_DESC" });
    if (!list || list.length === 0) list = FALLBACK_ANIME.map(normalizeAnime).filter(Boolean);
    renderGrid(grid, list);
    grid.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadMoviesPage() {
    showSkeletons($("#movies-grid"));
    let list = await fetchAnimeList({ format: "MOVIE", sort: "POPULARITY_DESC" });
    if (!list || list.length === 0) list = FALLBACK_ANIME.map(normalizeAnime).filter(Boolean);
    renderGrid($("#movies-grid"), list);
  }

  async function loadHindiDubbedPage() {
    showSkeletons($("#hindi-dubbed-grid"));
    let list = await fetchAnimeList({ sort: "POPULARITY_DESC" });
    if (!list || list.length === 0) list = FALLBACK_ANIME.map(normalizeAnime).filter(Boolean);
    renderGrid($("#hindi-dubbed-grid"), list, { showLangNote: true });
  }

  async function loadLatestPage() {
    showSkeletons($("#latest-grid"));
    let list = await fetchAnimeList({ sort: "START_DATE_DESC" });
    if (!list || list.length === 0) list = FALLBACK_ANIME.map(normalizeAnime).filter(Boolean);
    renderGrid($("#latest-grid"), list);
  }

  // -------------------------------------------------------
  // FAVORITES PAGE
  // -------------------------------------------------------
  function renderFavoritesPage() {
    const grid = $("#favorites-grid");
    const empty = $("#favorites-empty");
    if (!grid || !empty) return;

    const favorites = getFavorites();
    grid.innerHTML = "";

    if (!favorites.length) {
      grid.hidden = true;
      empty.hidden = false;
      return;
    }
    grid.hidden = false;
    empty.hidden = true;

    favorites.forEach((anime) => {
      const card = createAnimeCard(normalizeAnime(anime) || anime);
      if (card) grid.appendChild(card);
    });
  }

  function clearFavorites() {
    if (!getFavorites().length) {
      showToast("No favorites to clear.", "info");
      return;
    }
    if (!confirm("Remove all favorites? This cannot be undone.")) return;
    writeJSON(FAVORITES_KEY, []);
    renderFavoritesPage();
    refreshFavoriteButtons();
    showToast("Favorites cleared.", "success");
  }

  // -------------------------------------------------------
  // SEARCH
  // -------------------------------------------------------
  let searchDebounceTimer = null;

  function setupSearch() {
    const input = $("#global-search");
    const suggestions = $("#search-suggestions");
    const clearBtn = $("#clear-search-btn");
    if (!input || !suggestions) return;

    input.addEventListener("input", () => {
      const value = input.value.trim();
      if (clearBtn) clearBtn.hidden = !value;

      clearTimeout(searchDebounceTimer);
      if (!value) {
        suggestions.hidden = true;
        suggestions.innerHTML = "";
        return;
      }
      searchDebounceTimer = setTimeout(() => fetchSearchSuggestions(value), 320);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = input.value.trim();
        if (value) {
          suggestions.hidden = true;
          navigateToSearch(value);
        }
      }
      if (e.key === "Escape") {
        suggestions.hidden = true;
        input.blur();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        clearBtn.hidden = true;
        suggestions.hidden = true;
        input.focus();
      });
    }

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap")) suggestions.hidden = true;
    });
  }

  async function fetchSearchSuggestions(term) {
    const suggestions = $("#search-suggestions");
    if (!suggestions) return;

    suggestions.innerHTML = "";
    suggestions.hidden = false;
    suggestions.appendChild(el("li", { "aria-disabled": "true" }, "Searching…"));

    try {
      const query = `
        query ($search: String) {
          Page(page: 1, perPage: 6) {
            media(search: $search, type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
              id
              title { romaji english }
              seasonYear
              format
            }
          }
        }
      `;
      const data = await fetchGraphQL(query, { search: term });
      const items = data?.Page?.media || [];

      suggestions.innerHTML = "";
      if (!items.length) {
        suggestions.appendChild(el("li", { "aria-disabled": "true" }, "No suggestions"));
        return;
      }
      items.forEach((item) => {
        const label = item.title?.romaji || item.title?.english || "Unknown";
        const li = el("li", { role: "option", tabIndex: "0" },
          `${label}${item.seasonYear ? ` (${item.seasonYear})` : ""}`);
        li.addEventListener("click", () => { suggestions.hidden = true; navigateToAnime(item.id); });
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { suggestions.hidden = true; navigateToAnime(item.id); }
        });
        suggestions.appendChild(li);
      });
    } catch {
      suggestions.innerHTML = "";
      suggestions.appendChild(el("li", { "aria-disabled": "true" }, "Suggestions unavailable"));
    }
  }

  function navigateToSearch(term) {
    state.searchTerm = term;
    saveSearchHistory(term);
    navigateTo("search");
    loadSearchResults(term);
  }

  function saveSearchHistory(term) {
    const history = readJSON(SEARCH_HISTORY_KEY, []);
    const filtered = history.filter((h) => h.toLowerCase() !== term.toLowerCase());
    filtered.unshift(term);
    writeJSON(SEARCH_HISTORY_KEY, filtered.slice(0, 10));
  }

  async function loadSearchResults(term) {
    const grid = $("#search-results-grid");
    const empty = $("#search-empty");
    const statusBar = $("#search-status-bar");
    const label = $("#search-query-label");

    if (label) label.textContent = `Results for “${term}”`;
    if (statusBar) statusBar.hidden = true;
    if (empty) empty.hidden = true;

    showSkeletons(grid, 8);

    let list = await fetchAnimeList({ search: term, sort: "POPULARITY_DESC" });
    if (!list || list.length === 0) {
      try {
        const json = await jikanGet(`/anime?q=${encodeURIComponent(term)}&limit=${PAGE_SIZE}&sfw=true`);
        list = (json.data || []).map(mapJikanAnime).filter(Boolean);
      } catch { /* ignore */ }
    }

    if (!list || list.length === 0) {
      grid.innerHTML = "";
      grid.classList.remove("skeleton-grid");
      grid.removeAttribute("aria-busy");
      if (empty) empty.hidden = false;
      if (statusBar) {
        statusBar.hidden = false;
        statusBar.className = "status-bar";
        statusBar.textContent = "No results found. The API may be unavailable, or the title does not exist in the database.";
      }
      return;
    }

    renderGrid(grid, list);
  }

  // -------------------------------------------------------
  // DETAILS  (with stale-request guard)
  // -------------------------------------------------------
  async function loadDetailsPage(id) {
    const token = ++detailsRequestToken;
    const container = $("#details-content");
    const relatedGrid = $("#related-grid");
    if (!container) return;

    state.currentAnimeId = id;
    container.innerHTML = `<div class="skeleton-card" style="grid-column:1/-1;min-height:320px"></div>`;
    if (relatedGrid) relatedGrid.innerHTML = "";

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    `;

    let anime = null;
    try {
      const data = await fetchGraphQL(query, { id: Number(id) });
      if (token !== detailsRequestToken) return; // stale
      anime = normalizeAnime(data?.Media);
    } catch (err) {
      console.warn("Details fetch failed:", err.message);
    }

    if (token !== detailsRequestToken) return;

    if (!anime) {
      try {
        const json = await jikanGet(`/anime/${id}`);
        if (token !== detailsRequestToken) return;
        anime = normalizeAnime(mapJikanAnime(json.data));
      } catch { /* ignore */ }
    }

    if (token !== detailsRequestToken) return;

    if (!anime) {
      const fallback = FALLBACK_ANIME.find((a) => Number(a.id) === Number(id)) || FALLBACK_ANIME[0];
      anime = normalizeAnime(fallback);
      showToast("Live details unavailable — showing fallback sample.", "error");
    }

    pushRecent(anime);
    renderDetails(anime);
    renderRelated(anime);
  }

  function renderDetails(anime) {
    const container = $("#details-content");
    if (!container) return;
    container.innerHTML = "";

    const posterWrap = el("div", { className: "details-poster-wrap" });
    if (anime.coverImage.extraLarge) {
      const img = el("img", {
        className: "details-poster",
        src: anime.coverImage.extraLarge,
        alt: `Poster for ${anime.title.romaji}`,
        loading: "eager"
      });
      img.addEventListener("error", () => img.replaceWith(
        el("div", { className: "card-poster-fallback" }, "No poster available")));
      posterWrap.appendChild(img);
    } else {
      posterWrap.appendChild(el("div", { className: "card-poster-fallback" }, "No poster available"));
    }

    const main = el("div", { className: "details-main" });

    main.appendChild(el("h1", { className: "details-title", id: "details-heading" }, anime.title.romaji));
    if (anime.title.english && anime.title.english !== anime.title.romaji) {
      main.appendChild(el("p", { className: "details-alt-title" }, anime.title.english));
    }
    if (anime.synonyms.length) {
      main.appendChild(el("p", { className: "details-alt-title" }, anime.synonyms.slice(0, 3).join(" · ")));
    }

    const stats = el("div", { className: "details-stats" });
    if (anime.averageScore) {
      stats.appendChild(el("span", { className: "stat-pill score" }, `★ ${(anime.averageScore / 10).toFixed(1)}`));
    }
    if (anime.format) stats.appendChild(el("span", { className: "stat-pill" }, el("strong", {}, anime.format)));
    if (anime.status) {
      const statusText = anime.status === "RELEASING" ? "Airing"
        : anime.status === "FINISHED" ? "Completed"
        : anime.status === "NOT_YET_RELEASED" ? "Upcoming" : anime.status;
      stats.appendChild(el("span", { className: "stat-pill" }, statusText));
    }
    if (anime.seasonYear) stats.appendChild(el("span", { className: "stat-pill" }, String(anime.seasonYear)));
    if (anime.episodes) stats.appendChild(el("span", { className: "stat-pill" }, `${anime.episodes} episodes`));
    if (anime.studios.length) stats.appendChild(el("span", { className: "stat-pill" }, anime.studios[0]));
    main.appendChild(stats);

    if (anime.genres.length) {
      const genreWrap = el("div", { className: "details-genres" });
      anime.genres.forEach((g) => {
        const tag = el("button", { type: "button", className: "genre-tag" }, g);
        tag.addEventListener("click", () => {
          state.browseFilters.genre = g;
          const gSel = $("#browse-genre");
          if (gSel) gSel.value = g;
          navigateTo("browse");
          loadBrowsePage();
        });
        genreWrap.appendChild(tag);
      });
      main.appendChild(genreWrap);
    }

    if (anime.description) {
      const synopsis = anime.description.replace(/<[^>]*>/g, "").trim();
      main.appendChild(el("p", { className: "details-synopsis" }, synopsis));
    }

    const actions = el("div", { className: "details-actions" });

    // The Play button always uses the current anime's id — never a shared URL.
    const watchBtn = el("button", { type: "button", className: "btn btn-primary" }, "▶ Watch Now");
    watchBtn.addEventListener("click", () => navigateToPlayer(anime.id));
    actions.appendChild(watchBtn);

    const favBtn = el("button", { type: "button", className: "btn btn-ghost" },
      isFavorite(anime.id) ? "♥ Favorited" : "♡ Add to favorites");
    favBtn.addEventListener("click", () => {
      toggleFavorite(anime);
      favBtn.textContent = isFavorite(anime.id) ? "♥ Favorited" : "♡ Add to favorites";
    });
    actions.appendChild(favBtn);

    if (anime.trailer && anime.trailer.site === "youtube" && anime.trailer.id) {
      const trailer = el("a", {
        className: "btn btn-ghost",
        href: `https://www.youtube.com/watch?v=${encodeURIComponent(anime.trailer.id)}`,
        target: "_blank",
        rel: "noopener noreferrer"
      }, "▶ Trailer");
      actions.appendChild(trailer);
    }

    main.appendChild(actions);

    const table = el("table", { className: "details-meta-table" });
    const rows = [
      ["Japanese Title", anime.title.native],
      ["Alternative Titles", anime.synonyms.join(", ")],
      ["Episodes", anime.episodes],
      ["Duration", anime.duration ? `${anime.duration} min` : null],
      ["Status", anime.status],
      ["Studio", anime.studios.join(", ")],
      ["Popularity", anime.popularity],
      ["Favorites", anime.favourites]
    ];
    rows.forEach(([label, value]) => {
      if (!value) return;
      table.appendChild(el("tr", {}, el("th", {}, label), el("td", {}, String(value))));
    });
    main.appendChild(table);

    container.append(posterWrap, main);
  }

  function renderRelated(anime) {
    const grid = $("#related-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const related = [];
    (anime.relations || []).forEach((edge) => {
      if (edge.node) related.push(normalizeAnime(edge.node));
    });
    (anime.recommendations || []).forEach((rec) => {
      if (rec.mediaRecommendation) related.push(normalizeAnime(rec.mediaRecommendation));
    });

    if (!related.length) {
      grid.appendChild(
        el("div", { className: "empty-state", style: "grid-column:1/-1" },
          el("p", {}, "No related anime information available."))
      );
      return;
    }

    const unique = [];
    const seen = new Set();
    related.forEach((r) => {
      if (r && !seen.has(r.id)) { seen.add(r.id); unique.push(r); }
    });

    renderGrid(grid, unique.slice(0, 12));
  }

  // ============================================================
  // PLAYER  (fixed: per-anime, per-episode source, strict validation,
  //          stale-request protection, full reset between videos)
  // ============================================================

  function destroyHls() {
    if (state.hlsInstance) {
      try { state.hlsInstance.destroy(); } catch { /* ignore */ }
      state.hlsInstance = null;
    }
  }

  /**
   * Fully clear the <video> element and any HLS instance so nothing
   * from the previously selected anime can keep playing.
   */
  function resetPlayer() {
    destroyHls();
    const video = $("#anime-video");
    if (!video) return;
    try { video.pause(); } catch { /* ignore */ }
    video.removeAttribute("src");
    while (video.firstChild) video.removeChild(video.firstChild);
    try { video.load(); } catch { /* ignore */ }
    state.currentSource = null;
  }

  /**
   * Attach a URL to the <video>. Accepts mp4/webm or .m3u8 (HLS).
   * Only called with a URL that has already passed getVideoSource().
   */
  function setupVideoSource(video, url) {
    destroyHls();
    const isM3U8 = /\.m3u8(\?|$)/i.test(url);

    if (isM3U8) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
      } else if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ maxBufferLength: 30, enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        state.hlsInstance = hls;
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          console.error("HLS fatal error:", data);
          const curTitle = $("#player-anime-title")?.textContent || "This anime";
          const curEp = state.currentSource?.episodeNumber || 1;
          showToast("The video stream could not be loaded.", "error");
          showNoSourcePlaceholder(curTitle, curEp, "The configured stream failed to load.");
        });
      } else {
        video.src = url;
      }
    } else {
      video.src = url;
    }
    video.load();
  }

  /**
   * Load and start playback for a specific, already-validated source.
   * Sets state.currentSource so timeupdate can persist progress to the
   * correct anime id.
   */
  function playSelectedEpisode(source) {
    const video = $("#anime-video");
    const placeholder = $("#player-placeholder");
    if (!video || !source || !source.url) return;

    resetPlayer();
    state.currentSource = { animeId: source.animeId, episodeNumber: source.episodeNumber };
    if (placeholder) placeholder.hidden = true;

    setupVideoSource(video, source.url);

    // Restore user's playback preferences
    const speedSelect = $("#playback-speed");
    const volumeSlider = $("#volume-slider");
    if (speedSelect) video.playbackRate = parseFloat(speedSelect.value) || 1;
    if (volumeSlider) video.volume = parseFloat(volumeSlider.value);

    // Resume progress for THIS anime only
    const progress = getProgress(source.animeId);
    if (progress && progress.currentTime > 0 && progress.duration > 0) {
      video.addEventListener("loadedmetadata", () => {
        if (progress.currentTime < progress.duration - 10) {
          video.currentTime = progress.currentTime;
          showToast("Resumed from where you left off.", "info");
        }
      }, { once: true });
    }
  }

  /**
   * Clear the video and show a specific, honest placeholder that
   * names the anime and episode — never an unrelated video.
   */
  function showNoSourcePlaceholder(animeTitle, episodeNumber, reason) {
    const placeholder = $("#player-placeholder");
    if (!placeholder) return;
    placeholder.hidden = false;
    placeholder.innerHTML = "";

    const epLabel = episodeNumber && episodeNumber > 0 ? ` — Episode ${episodeNumber}` : "";
    placeholder.append(
      el("div", { className: "placeholder-icon", "aria-hidden": "true" }, "▶"),
      el("h2", {}, "No authorized stream configured"),
      el("p", {}, `${animeTitle || "This anime"}${epLabel}`),
      el("p", {}, reason ||
        "This site does not host or scrape copyrighted anime streams. Metadata APIs do not provide video files."),
      el("p", {}, "To enable playback, add a licensed video URL for this anime and episode to the VIDEO_SOURCES map inside script.js.")
    );
  }

  function navigateToPlayer(id) {
    state.currentPlayerAnimeId = id;
    navigateTo("watch", id);
  }

  async function loadPlayerPage(id) {
    const token = ++playerRequestToken;

    // Wipe previous video IMMEDIATELY — no stale frame or audio.
    resetPlayer();

    const titleEl = $("#player-anime-title");
    const episodeSelect = $("#episode-select");
    const placeholder = $("#player-placeholder");

    if (titleEl) titleEl.textContent = "";
    if (placeholder) placeholder.hidden = false;
    if (episodeSelect) { episodeSelect.innerHTML = ""; episodeSelect.disabled = true; }

    state.currentPlayerAnimeId = id;

    // Fetch metadata for THIS anime only
    let anime = null;
    try {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            title { romaji english }
            episodes
            format
            status
          }
        }
      `;
      const data = await fetchGraphQL(query, { id: Number(id) });
      anime = data?.Media;
    } catch { /* ignore */ }

    if (token !== playerRequestToken) return; // a newer request has superseded us

    if (!anime) {
      const fallback = FALLBACK_ANIME.find((a) => Number(a.id) === Number(id)) || FALLBACK_ANIME[0];
      anime = { id: fallback.id, title: fallback.title, episodes: fallback.episodes };
    }

    if (token !== playerRequestToken) return;

    const title = safeText(anime.title?.romaji || anime.title?.english, "Unknown anime");
    if (titleEl) titleEl.textContent = title;

    // Determine episode options:
    //   - If any sources are configured for this anime, show those.
    //   - Otherwise show metadata episode count (max 24) so users can
    //     see what exists — but selecting one still shows the honest
    //     "no source" placeholder for that episode.
    const animeKey = String(anime.id);
    const sourceMap = VIDEO_SOURCES[animeKey] || {};
    const configuredEpNums = Object.keys(sourceMap)
      .map(Number)
      .filter((n) => Number.isFinite(n) && sourceMap[String(n)]?.url)
      .sort((a, b) => a - b);

    const fallbackCount = Math.max(1, Math.min(anime.episodes || 1, 24));
    const episodeOptions = configuredEpNums.length > 0
      ? configuredEpNums
      : Array.from({ length: fallbackCount }, (_, i) => i + 1);

    if (episodeSelect) {
      episodeSelect.innerHTML = "";
      episodeOptions.forEach((n) => {
        episodeSelect.appendChild(el("option", { value: String(n) }, `Episode ${n}`));
      });
      episodeSelect.disabled = episodeOptions.length <= 1;
      if (episodeOptions.length) episodeSelect.value = String(episodeOptions[0]);
    }

    // Look up the actual source for this anime + first episode.
    const firstEp = episodeOptions[0] || 1;
    const source = getVideoSource(anime.id, firstEp);

    if (token !== playerRequestToken) return;

    if (!source) {
      // Honest placeholder — never falls back to an unrelated stream.
      showNoSourcePlaceholder(title, firstEp);
      return;
    }

    playSelectedEpisode(source);
  }

  function setupPlayerControls() {
    const video = $("#anime-video");
    const speed = $("#playback-speed");
    const volume = $("#volume-slider");
    const episodeSelect = $("#episode-select");

    if (speed && video) {
      speed.addEventListener("change", () => {
        video.playbackRate = parseFloat(speed.value) || 1;
      });
    }
    if (volume && video) {
      volume.addEventListener("input", () => {
        video.volume = parseFloat(volume.value);
      });
    }

    if (episodeSelect) {
      episodeSelect.addEventListener("change", () => {
        const animeId = state.currentPlayerAnimeId;
        if (animeId === null || animeId === undefined) return;
        const epNum = Number(episodeSelect.value) || 1;
        const source = getVideoSource(animeId, epNum);
        const title = $("#player-anime-title")?.textContent || "This anime";

        if (!source) {
          resetPlayer();
          showNoSourcePlaceholder(title, epNum);
          return;
        }
        playSelectedEpisode(source);
      });
    }

    // One-time listeners — they read state.currentSource at fire time.
    if (video && video.dataset.listenersAttached !== "true") {
      video.dataset.listenersAttached = "true";

      video.addEventListener("timeupdate", () => {
        if (!video.duration || !state.currentSource) return;
        saveProgress(state.currentSource.animeId, video.currentTime, video.duration);
      }, { passive: true });

      video.addEventListener("error", () => {
        if (!state.currentSource) return;
        const title = $("#player-anime-title")?.textContent || "This anime";
        const ep = state.currentSource.episodeNumber;
        showToast("Video playback error. The source may be unavailable.", "error");
        showNoSourcePlaceholder(title, ep, "The configured stream failed to load.");
      });
    }
  }

  // -------------------------------------------------------
  // ROUTING
  // -------------------------------------------------------
  function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, "");
    if (!raw) return { page: "home" };
    const parts = raw.split("/");
    const page = parts[0] || "home";
    if (page === "anime" && parts[1]) return { page: "details", id: parts[1] };
    if (page === "watch" && parts[1]) return { page: "player", id: parts[1] };
    return { page };
  }

  function navigateTo(page, id) {
    if (page === "details" || page === "anime") {
      window.location.hash = `#anime/${id}`;
    } else if (page === "watch" || page === "player") {
      window.location.hash = `#watch/${id}`;
    } else if (page === "search") {
      window.location.hash = "#search";
    } else {
      window.location.hash = `#${page}`;
    }
  }

  function navigateToAnime(id) {
    navigateTo("details", id);
  }

  function showSection(pageId) {
    state.currentPage = pageId;

    // Pause the video when leaving the player — prevents audio from a
    // previous anime continuing while the user browses elsewhere.
    if (pageId !== "player") {
      const video = $("#anime-video");
      if (video && !video.paused) {
        try { video.pause(); } catch { /* ignore */ }
      }
    }

    $$(".app-section").forEach((section) => {
      section.classList.toggle("active", section.id === `section-${pageId}`);
    });
    $$(".nav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.nav === pageId);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleRoute() {
    const route = parseHash();
    const loader = $("#route-loader");
    if (loader) loader.hidden = false;

    try {
      switch (route.page) {
        case "home":
          showSection("home");
          await loadHomePage();
          break;

        case "browse":
          showSection("browse");
          await loadBrowsePage();
          break;

        case "genres":
          showSection("genres");
          loadGenresPage();
          break;

        case "movies":
          showSection("movies");
          await loadMoviesPage();
          break;

        case "hindi-dubbed":
          showSection("hindi-dubbed");
          await loadHindiDubbedPage();
          break;

        case "latest":
          showSection("latest");
          await loadLatestPage();
          break;

        case "favorites":
          showSection("favorites");
          renderFavoritesPage();
          break;

        case "search":
          showSection("search");
          if (state.searchTerm) await loadSearchResults(state.searchTerm);
          break;

        case "details":
          showSection("details");
          if (route.id) await loadDetailsPage(route.id);
          else navigateTo("home");
          break;

        case "player":
          showSection("player");
          if (route.id) await loadPlayerPage(route.id);
          else navigateTo("home");
          break;

        default:
          showSection("home");
          await loadHomePage();
      }
    } catch (err) {
      console.error("Route error:", err);
      showToast("Something went wrong while loading this page.", "error");
    } finally {
      if (loader) loader.hidden = true;
    }
  }

  // -------------------------------------------------------
  // MOBILE MENU
  // -------------------------------------------------------
  function setupMobileMenu() {
    const toggle = $("#mobile-menu-toggle");
    const nav = $("#main-nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      nav.classList.toggle("open", !expanded);
      toggle.setAttribute("aria-label", !expanded ? "Close menu" : "Open menu");
    });

    nav.addEventListener("click", (e) => {
      if (e.target.closest(".nav-link")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      }
    });
  }

  // -------------------------------------------------------
  // EVENT BINDINGS
  // -------------------------------------------------------
  function bindEvents() {
    const refreshBtn = $("#refresh-home-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        state.homeLoaded = false;
        loadHomePage(true);
        showToast("Refreshing homepage metadata…", "info");
      });
    }

    const detailsBack = $("#details-back-btn");
    if (detailsBack) {
      detailsBack.addEventListener("click", () => {
        if (history.length > 1) history.back();
        else navigateTo("home");
      });
    }

    const playerBack = $("#player-back-btn");
    if (playerBack) {
      playerBack.addEventListener("click", () => {
        if (state.currentPlayerAnimeId) navigateTo("details", state.currentPlayerAnimeId);
        else navigateTo("home");
      });
    }

    const browseForm = $("#browse-filters-form");
    if (browseForm) browseForm.addEventListener("submit", handleBrowseFilterSubmit);

    const resetBtn = $("#reset-browse-filters");
    if (resetBtn) resetBtn.addEventListener("click", resetBrowseFilters);

    const clearFavBtn = $("#clear-favorites-btn");
    if (clearFavBtn) clearFavBtn.addEventListener("click", clearFavorites);

    window.addEventListener("hashchange", handleRoute);

    setupPlayerControls();
    setupMobileMenu();
    setupSearch();
  }

  // -------------------------------------------------------
  // INIT
  // -------------------------------------------------------
  function init() {
    bindEvents();

    if (!window.location.hash) {
      history.replaceState(null, "", "#home");
    }

    handleRoute();

    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        e.preventDefault();
        $("#global-search")?.focus();
      }
    });

    window.addEventListener("offline", () => showToast("You are offline. Some features may be unavailable.", "error"));
    window.addEventListener("online", () => showToast("Back online.", "success"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();