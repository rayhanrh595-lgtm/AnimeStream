// js/api.js
// Metadata: Jikan (https://docs.api.jikan.moe) — public, no key required.
// Streaming: provider adapter interface. No provider is configured in this demo.
// NEVER put secret provider keys in frontend code — use a backend proxy (see README).

export const CONFIG = {
  jikanBaseUrl: 'https://api.jikan.moe/v4',
  cacheTtlMs: 30 * 60 * 1000,   // 30 minutes
  requestGapMs: 420,            // Jikan allows 3 req/s — keep a safe gap
  demoMode: true,               // demo previews only; set false in production
  streaming: {
    provider: 'none',           // e.g. 'licensed-provider-name'
    apiBaseUrl: '',             // e.g. 'https://your-backend.example.com/api/stream'
    configured: false           // true only after a real provider is wired up
  }
};

/* =========================================================
   Helpers
   ========================================================= */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

export function safeUrl(value) {
  if (typeof value !== 'string') return '';
  return /^https?:\/\//i.test(value) ? value : '';
}

/* =========================================================
   localStorage cache
   ========================================================= */

const CACHE_PREFIX = 'av:cache:';

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CONFIG.cacheTtlMs) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* storage full / blocked — ignore */
  }
}

/* =========================================================
   Rate-limited request queue
   ========================================================= */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;
let queueChain = Promise.resolve();

function schedule(fn) {
  const run = async () => {
    const wait = CONFIG.requestGapMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  };
  const promise = queueChain.then(run, run);
  queueChain = promise.then(() => {}, () => {});
  return promise;
}

async function request(path) {
  const cached = readCache(path);
  if (cached) return cached;

  const url = path.startsWith('http') ? path : `${CONFIG.jikanBaseUrl}${path}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await schedule(() => fetch(url, {
      headers: { Accept: 'application/json' },
      mode: 'cors'
    }));

    if (response.status === 429 && attempt === 0) {
      await sleep(1600);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Metadata request failed (HTTP ${response.status}).`);
    }
    const json = await response.json();
    writeCache(path, json);
    return json;
  }
  throw new Error('The metadata API is rate limiting requests. Please try again shortly.');
}

/* =========================================================
   Normalisation
   ========================================================= */

export function normalizeAnime(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const images = raw.images || {};
  const poster =
    images.webp?.large_image_url ||
    images.jpg?.large_image_url ||
    images.webp?.image_url ||
    images.jpg?.image_url ||
    '';

  return {
    id: raw.mal_id ?? raw.id ?? null,
    title: raw.title_english || raw.title || raw.name || 'Untitled',
    originalTitle: raw.title || '',
    japaneseTitle: raw.title_japanese || '',
    poster: safeUrl(poster),
    synopsis: raw.synopsis || raw.description || '',
    genres: Array.isArray(raw.genres) ? raw.genres.map((g) => g.name) : [],
    studios: Array.isArray(raw.studios) ? raw.studios.map((s) => s.name) : [],
    year: raw.year || raw.aired?.prop?.from?.year || null,
    season: raw.season || '',
    type: raw.type || '',
    status: raw.status || '',
    episodes: Number.isFinite(raw.episodes) ? raw.episodes : null,
    score: Number.isFinite(raw.score) ? raw.score : null,
    rank: Number.isFinite(raw.rank) ? raw.rank : null,
    airing: Boolean(raw.airing),
    trailer: safeUrl(raw.trailer?.embed_url || ''),
    url: safeUrl(raw.url || '')
  };
}

function normalizeEntry(entry) {
  const raw = entry?.entry || entry;
  if (!raw) return null;
  const images = raw.images || {};
  return {
    id: raw.mal_id ?? null,
    title: raw.title || 'Untitled',
    poster: safeUrl(images.webp?.image_url || images.jpg?.image_url || ''),
    type: raw.type || '',
    year: null,
    episodes: null,
    score: null,
    airing: false,
    synopsis: ''
  };
}

const cleanList = (items) => items.map(normalizeAnime).filter((item) => item && item.id);

/* =========================================================
   Jikan endpoints
   ========================================================= */

export async function fetchTopAnime({ filter = '', limit = 14, page = 1 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), page: String(page) });
  if (filter) params.set('filter', filter);
  const json = await request(`/top/anime?${params.toString()}`);
  return cleanList(json.data || []);
}

export async function fetchSeasonNow({ limit = 14, page = 1 } = {}) {
  const json = await request(`/seasons/now?limit=${limit}&page=${page}&sfw=true`);
  return cleanList(json.data || []);
}

export async function fetchUpcomingAnime({ limit = 14, page = 1 } = {}) {
  const json = await request(`/seasons/upcoming?limit=${limit}&page=${page}&sfw=true`);
  return cleanList(json.data || []);
}

export async function fetchMovieAnime(limit = 14, page = 1) {
  const json = await request(
    `/anime?type=movie&order_by=score&sort=desc&limit=${limit}&page=${page}&sfw=true`
  );
  return cleanList(json.data || []);
}

export async function searchAnime({
  q = '', genres = '', type = '', status = '', year = '',
  orderBy = 'popularity', sort = 'asc', page = 1, limit = 24
} = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
    sfw: 'true',
    order_by: orderBy,
    sort
  });
  if (q) params.set('q', q);
  if (genres) params.set('genres', genres);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (year) {
    params.set('start_date', `${year}-01-01`);
    params.set('end_date', `${year}-12-31`);
  }

  const json = await request(`/anime?${params.toString()}`);
  return {
    items: cleanList(json.data || []),
    page: json.pagination?.current_page || page,
    lastPage: json.pagination?.last_visible_page || 1,
    hasNext: Boolean(json.pagination?.has_next_page)
  };
}

export async function getAnime(id) {
  const json = await request(`/anime/${encodeURIComponent(id)}/full`);
  return normalizeAnime(json.data || {});
}

export async function getEpisodes(id, page = 1) {
  const json = await request(`/anime/${encodeURIComponent(id)}/episodes?page=${page}`);
  const episodes = (json.data || []).map((ep) => ({
    id: ep.mal_id,
    number: ep.mal_id,
    title: ep.title || `Episode ${ep.mal_id}`,
    aired: ep.aired || null,
    filler: Boolean(ep.filler)
  }));
  return {
    episodes,
    hasNext: Boolean(json.pagination?.has_next_page),
    lastPage: json.pagination?.last_visible_page || 1
  };
}

export async function getRecommendations(id, limit = 12) {
  try {
    const json = await request(`/anime/${encodeURIComponent(id)}/recommendations`);
    return (json.data || [])
      .slice(0, limit)
      .map((row) => normalizeEntry(row))
      .filter((item) => item && item.id);
  } catch {
    return [];
  }
}

export async function getGenres() {
  const json = await request('/genres/anime?filter=genres');
  return (json.data || []).map((g) => ({ id: g.mal_id, name: g.name, count: g.count }));
}

/* =========================================================
   Streaming provider adapter
   ---------------------------------------------------------
   No provider is configured in this demo. Each function returns
   a structured "unavailable" result so the UI can degrade
   gracefully instead of inventing streams.

   To integrate a real provider, implement these functions
   against that provider's documented API. If the provider
   needs a secret key, call YOUR backend proxy — never ship
   the key in this file.
   ========================================================= */

const NOT_CONFIGURED = Object.freeze({
  ok: false,
  reason: 'provider_not_configured',
  message: 'No streaming provider is configured. See README → Streaming provider integration.'
});

function notConfigured(extra = {}) {
  return { ...NOT_CONFIGURED, ...extra };
}

export const streaming = {
  /** @returns {boolean} */
  isConfigured() {
    return Boolean(CONFIG.streaming.configured && CONFIG.streaming.apiBaseUrl);
  },

  /** Search the provider catalogue by title. */
  async searchAnime(title) {
    if (!this.isConfigured()) return notConfigured({ data: [], title });
    // Example shape when implemented:
    // const res = await fetch(`${CONFIG.streaming.apiBaseUrl}/search?q=${encodeURIComponent(title)}`);
    // return { ok: true, data: (await res.json()).results };
    return notConfigured({ data: [], title });
  },

  /** Fetch provider details for a metadata record. */
  async getAnimeDetails(animeId) {
    if (!this.isConfigured()) return notConfigured({ data: null, animeId });
    return notConfigured({ data: null, animeId });
  },

  /** List episodes the provider has actually published. */
  async getEpisodes(animeId) {
    if (!this.isConfigured()) return notConfigured({ data: [], animeId });
    return notConfigured({ data: [], animeId });
  },

  /** Return playback sources (HLS/DASH/MP4) for an episode. */
  async getStreamingSources(episodeId) {
    if (!this.isConfigured()) return notConfigured({ data: [], episodeId });
    return notConfigured({ data: [], episodeId });
  },

  /** Return a provider-documented embed URL, if embedding is permitted. */
  async getEmbedUrl(episodeId) {
    if (!this.isConfigured()) return notConfigured({ url: null, episodeId });
    return notConfigured({ url: null, episodeId });
  },

  /** Return the next episode id, or null. */
  async getNextEpisode(episodeId) {
    if (!this.isConfigured()) return notConfigured({ nextEpisodeId: null, episodeId });
    return notConfigured({ nextEpisodeId: null, episodeId });
  },

  /** Verified audio/subtitle languages for an anime. Empty until a provider confirms them. */
  async getVerifiedLanguages() {
    if (!this.isConfigured()) return notConfigured({ audio: [], subtitles: [] });
    return notConfigured({ audio: [], subtitles: [] });
  }
};