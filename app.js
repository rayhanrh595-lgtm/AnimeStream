// js/app.js — shared UI helpers, navigation, search suggestions and homepage feeds
import {
  CONFIG, escapeHtml, safeUrl,
  fetchTopAnime, fetchSeasonNow, fetchUpcomingAnime, fetchMovieAnime, searchAnime
} from './api.js';
import { continueWatching, prefs } from './storage.js';

/* =========================================================
   Reusable UI helpers (exported for the page modules)
   ========================================================= */

export function debounce(fn, wait = 320) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function setBusy(el, busy) {
  if (el) el.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export function skeleton(el, count = 6) {
  if (!el) return;
  const card = `
    <div class="anime-card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-poster"></div>
      <div class="card-info">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </div>`;
  el.innerHTML = card.repeat(count);
  setBusy(el, true);
}

export function noticeHtml(message, tone = 'info') {
  return `<p class="notice notice-${tone} feed-note">${escapeHtml(message)}</p>`;
}

export function emptyState(el, { title = 'Nothing found', message = '', icon = 'fa-ghost' } = {}) {
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state">
      <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
    </div>`;
  setBusy(el, false);
}

export function errorState(el, message) {
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
      <h3>Something went wrong</h3>
      <p>${escapeHtml(message || 'Please try again in a moment.')}</p>
    </div>`;
  setBusy(el, false);
}

export function toast(message, tone = 'info') {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${tone}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

/** Build an anime card as an HTML string. */
export function createAnimeCard(anime, options = {}) {
  const { demo = false, showType = true } = options;
  const id = encodeURIComponent(anime.id);
  const score = Number.isFinite(anime.score) ? Number(anime.score).toFixed(1) : null;
  const poster = safeUrl(anime.poster);

  return `
    <article class="anime-card">
      <a class="card-link" href="anime.html?id=${id}">
        <div class="card-poster">
          ${poster
            ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(anime.title)} poster" loading="lazy" decoding="async" width="300" height="450">`
            : `<div class="poster-fallback"><i class="fas fa-image" aria-hidden="true"></i></div>`}
          ${score ? `<span class="card-rating"><i class="fas fa-star" aria-hidden="true"></i>${score}</span>` : ''}
          ${showType && anime.type ? `<span class="card-type">${escapeHtml(anime.type)}</span>` : ''}
          ${demo ? `<span class="card-demo">DEMO</span>` : ''}
        </div>
        <div class="card-info">
          <h3 class="card-title">${escapeHtml(anime.title)}</h3>
          <div class="card-meta">
            ${anime.year ? `<span>${escapeHtml(anime.year)}</span>` : ''}
            ${anime.episodes ? `<span>${escapeHtml(anime.episodes)} eps</span>` : ''}
            ${anime.airing ? '<span class="live">Airing</span>' : ''}
          </div>
        </div>
      </a>
    </article>`;
}

export function renderCards(el, list, options = {}) {
  if (!el) return;
  if (!list || !list.length) {
    emptyState(el, { title: 'No results', message: 'Try a different filter or search term.', icon: 'fa-magnifying-glass' });
    return;
  }
  el.innerHTML = list.map((anime) => createAnimeCard(anime, options)).join('');
  setBusy(el, false);
}

/* =========================================================
   Navigation
   ========================================================= */

function initNav() {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('primaryNav');

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  const page = document.body.dataset.page;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === page) link.classList.add('active');
  });

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const form = document.getElementById('navSearchForm');
  const input = document.getElementById('navSearchInput');
  const list = document.getElementById('navSuggestions');

  if (!form || !input || !list) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = input.value.trim();
    window.location.href = q ? `search.html?q=${encodeURIComponent(q)}` : 'search.html';
  });

  const closeList = () => { list.hidden = true; list.innerHTML = ''; };

  const renderSuggestions = (items) => {
    if (!items.length) {
      list.innerHTML = '<li class="s-empty">No matching titles.</li>';
      list.hidden = false;
      return;
    }
    list.innerHTML = items.map((anime) => `
      <li>
        <a href="anime.html?id=${encodeURIComponent(anime.id)}">
          ${anime.poster ? `<img src="${escapeHtml(anime.poster)}" alt="" loading="lazy">` : ''}
          <span>
            <span class="s-title">${escapeHtml(anime.title)}</span>
            <span class="s-meta">${escapeHtml([anime.type, anime.year].filter(Boolean).join(' · '))}</span>
          </span>
        </a>
      </li>`).join('');
    list.hidden = false;
  };

  const suggest = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { closeList(); return; }
    try {
      const { items } = await searchAnime({ q, limit: 6, orderBy: 'popularity', sort: 'asc' });
      if (input.value.trim() !== q) return; // stale response
      renderSuggestions(items);
    } catch {
      closeList();
    }
  }, 380);

  input.addEventListener('input', suggest);
  input.addEventListener('focus', () => { if (list.innerHTML) list.hidden = false; });

  document.addEventListener('click', (event) => {
    if (!form.contains(event.target)) closeList();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeList();
    if (event.key === 'ArrowDown') {
      const first = list.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
}

/* =========================================================
   Homepage feeds
   ========================================================= */

const LANGUAGE_FEEDS = new Set(['hindiDubbed', 'hindiSubbed', 'englishDubbed']);

const LANG_NOTE = 'Demo preview only — language labels below are sample placeholders, not verified data. ' +
  'Audio/subtitle availability must be confirmed by a licensed streaming provider.';

const FEED_LOADERS = {
  trending: () => fetchTopAnime({ filter: 'airing', limit: 14 }),
  popular: () => fetchTopAnime({ limit: 14 }),
  recent: () => fetchSeasonNow({ limit: 14 }),
  latest: () => fetchSeasonNow({ limit: 14 }),
  airing: () => fetchTopAnime({ filter: 'airing', limit: 14, page: 1 }),
  upcoming: () => fetchUpcomingAnime({ limit: 14 }),
  movies: () => fetchMovieAnime(14),
  recommended: () => fetchTopAnime({ filter: 'favorite', limit: 14 }),
  hindiDubbed: () => fetchTopAnime({ limit: 12 }),
  hindiSubbed: () => fetchTopAnime({ limit: 12 }),
  englishDubbed: () => fetchTopAnime({ limit: 12 })
};

async function loadHero() {
  const image = document.getElementById('heroImage');
  const title = document.getElementById('heroTitle');
  const meta = document.getElementById('heroMeta');
  const synopsis = document.getElementById('heroSynopsis');
  const watch = document.getElementById('heroWatch');

  try {
    const [featured] = await fetchTopAnime({ limit: 1 });
    if (!featured) return;

    if (image) {
      image.src = featured.poster || '';
      image.alt = `${featured.title} key visual`;
    }
    if (title) title.textContent = featured.title;
    if (meta) {
      meta.innerHTML = [
        featured.score ? `<span><i class="fas fa-star" aria-hidden="true"></i>${featured.score.toFixed(1)}</span>` : '',
        featured.year ? `<span><i class="fas fa-calendar" aria-hidden="true"></i>${escapeHtml(featured.year)}</span>` : '',
        featured.type ? `<span><i class="fas fa-tv" aria-hidden="true"></i>${escapeHtml(featured.type)}</span>` : '',
        featured.episodes ? `<span><i class="fas fa-list" aria-hidden="true"></i>${escapeHtml(featured.episodes)} eps</span>` : '',
        featured.status ? `<span><i class="fas fa-signal" aria-hidden="true"></i>${escapeHtml(featured.status)}</span>` : ''
      ].filter(Boolean).join('');
    }
    if (synopsis) synopsis.textContent = featured.synopsis || '';
    if (watch) watch.href = `anime.html?id=${encodeURIComponent(featured.id)}`;
  } catch (error) {
    if (title) title.textContent = 'AnimeVerse';
    if (synopsis) synopsis.textContent = 'Could not load featured anime right now. Please refresh in a moment.';
    console.warn('[AnimeVerse] Hero feed failed:', error);
  }
}

async function loadFeed(container) {
  const name = container.dataset.feed;
  const loader = FEED_LOADERS[name];
  if (!loader) return;

  if (name === 'continue') {
    loadContinueFeed(container);
    return;
  }

  skeleton(container, container.classList.contains('card-row') ? 7 : 8);

  try {
    const items = await loader();
    if (!items.length) {
      emptyState(container, { title: 'No titles available', message: 'The metadata provider returned no results.' });
      return;
    }
    const isLang = LANGUAGE_FEEDS.has(name);
    container.innerHTML =
      (isLang ? noticeHtml(LANG_NOTE, 'warn') : '') +
      items.map((anime) => createAnimeCard(anime, { demo: isLang })).join('');
    setBusy(container, false);
  } catch (error) {
    console.warn(`[AnimeVerse] Feed "${name}" failed:`, error);
    errorState(container, error.message);
  }
}

function loadContinueFeed(container) {
  const entries = continueWatching.list();
  if (!entries.length) {
    emptyState(container, {
      title: 'Nothing in progress',
      message: 'Start watching an episode and it will appear here.',
      icon: 'fa-clock'
    });
    return;
  }
  container.innerHTML = entries.map((entry) => `
    <article class="anime-card">
      <a class="card-link" href="watch.html?anime=${encodeURIComponent(entry.animeId)}&ep=${encodeURIComponent(entry.episode)}">
        <div class="card-poster">
          ${entry.poster
            ? `<img src="${escapeHtml(entry.poster)}" alt="${escapeHtml(entry.title)} poster" loading="lazy">`
            : `<div class="poster-fallback"><i class="fas fa-image" aria-hidden="true"></i></div>`}
          <span class="card-type">Ep ${escapeHtml(entry.episode)}</span>
        </div>
        <div class="card-info">
          <h3 class="card-title">${escapeHtml(entry.title)}</h3>
          <div class="card-meta"><span>Resume watching</span></div>
        </div>
      </a>
    </article>`).join('');
  setBusy(container, false);
}

function initHome() {
  loadHero();

  document.querySelectorAll('[data-feed]').forEach((container) => {
    if (container.dataset.feed === 'continue') {
      const section = document.getElementById('continueSection');
      if (section && continueWatching.list().length) {
        section.hidden = false;
        loadContinueFeed(container);
      }
      return;
    }
    loadFeed(container);
  });

  const clear = document.getElementById('clearContinue');
  if (clear) {
    clear.addEventListener('click', () => {
      continueWatching.clear();
      const section = document.getElementById('continueSection');
      if (section) section.hidden = true;
      toast('Continue Watching cleared.', 'success');
    });
  }
}

/* =========================================================
   Local profile (login.html)
   ========================================================= */

function initProfile() {
  const form = document.getElementById('profileForm');
  const status = document.getElementById('profileStatus');
  if (!form) return;

  const current = prefs.get();
  const nameInput = document.getElementById('displayName');
  const audio = document.getElementById('prefAudio');
  const subs = document.getElementById('prefSubs');

  if (nameInput) nameInput.value = current.displayName || '';
  if (audio) audio.value = current.audio || 'japanese';
  if (subs) subs.value = current.subs || 'english';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    prefs.set({
      displayName: (nameInput?.value || '').trim().slice(0, 40),
      audio: audio?.value || 'japanese',
      subs: subs?.value || 'english'
    });
    if (status) {
      status.hidden = false;
      status.textContent = 'Saved to this browser only (localStorage). No account was created on a server.';
    }
    toast('Profile saved locally.', 'success');
  });
}

/* =========================================================
   Boot
   ========================================================= */

function init() {
  initNav();
  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'login') initProfile();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}