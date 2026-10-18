// js/search.js — search page: filters, URL state, pagination
import { searchAnime, getGenres, escapeHtml } from './api.js';
import { renderCards, skeleton, emptyState, errorState, setBusy, debounce, toast } from './app.js';

const form = document.getElementById('searchForm');
const grid = document.getElementById('resultsGrid');
const countEl = document.getElementById('resultsCount');
const loadMoreBtn = document.getElementById('loadMore');
const resetBtn = document.getElementById('resetFilters');
const genreSelect = document.getElementById('genres');
const yearSelect = document.getElementById('year');
const qInput = document.getElementById('q');
const typeSelect = document.getElementById('type');
const statusSelect = document.getElementById('status');
const sortSelect = document.getElementById('sort');

const SORT_MAP = {
  popularity: { orderBy: 'popularity', sort: 'asc' },
  rating: { orderBy: 'score', sort: 'desc' },
  newest: { orderBy: 'start_date', sort: 'desc' },
  title: { orderBy: 'title', sort: 'asc' }
};

const state = {
  q: '', genres: '', year: '', type: '', status: '',
  sort: 'popularity', page: 1, lastPage: 1, loading: false
};

/* ---------- Populate selects ---------- */

function populateYears() {
  if (!yearSelect) return;
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear + 1; y >= 1960; y -= 1) years.push(y);
  yearSelect.insertAdjacentHTML('beforeend',
    years.map((y) => `<option value="${y}">${y}</option>`).join(''));
}

async function populateGenres() {
  if (!genreSelect) return;
  try {
    const genres = await getGenres();
    genreSelect.insertAdjacentHTML('beforeend',
      genres.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join(''));
  } catch {
    genreSelect.insertAdjacentHTML('beforeend', '<option value="" disabled>Genres unavailable</option>');
  }
}

/* ---------- URL <-> state ---------- */

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  state.q = params.get('q') || '';
  state.genres = params.get('genres') || '';
  state.year = params.get('year') || '';
  state.type = params.get('type') || '';
  state.status = params.get('status') || '';
  state.sort = SORT_MAP[params.get('sort')] ? params.get('sort') : 'popularity';
  state.page = Math.max(1, Number(params.get('page')) || 1);
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.genres) params.set('genres', state.genres);
  if (state.year) params.set('year', state.year);
  if (state.type) params.set('type', state.type);
  if (state.status) params.set('status', state.status);
  if (state.sort !== 'popularity') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  const url = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
  window.history.replaceState({}, '', url);
}

function syncFormFromState() {
  if (qInput) qInput.value = state.q;
  if (genreSelect && state.genres) genreSelect.value = state.genres;
  if (yearSelect && state.year) yearSelect.value = state.year;
  if (typeSelect) typeSelect.value = state.type;
  if (statusSelect) statusSelect.value = state.status;
  if (sortSelect) sortSelect.value = state.sort;
}

function readForm() {
  state.q = (qInput?.value || '').trim();
  state.genres = genreSelect?.value || '';
  state.year = yearSelect?.value || '';
  state.type = typeSelect?.value || '';
  state.status = statusSelect?.value || '';
  state.sort = sortSelect?.value || 'popularity';
}

/* ---------- Rendering ---------- */

function updateCount(total, hasNext) {
  if (!countEl) return;
  if (!total && state.page === 1) {
    countEl.textContent = 'No anime matched those filters.';
    return;
  }
  countEl.textContent = `Showing ${total} result${total === 1 ? '' : 's'}${hasNext ? ' (more available)' : ''}.`;
}

async function runSearch({ append = false } = {}) {
  if (!grid || state.loading) return;
  state.loading = true;

  const mapping = SORT_MAP[state.sort] || SORT_MAP.popularity;

  if (!append) {
    skeleton(grid, 10);
    setBusy(grid, true);
  } else if (loadMoreBtn) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading…';
  }

  try {
    const result = await searchAnime({
      q: state.q,
      genres: state.genres,
      type: state.type,
      status: state.status,
      year: state.year,
      orderBy: mapping.orderBy,
      sort: mapping.sort,
      page: state.page,
      limit: 24
    });

    state.lastPage = result.lastPage;

    if (append) {
      const html = result.items.map((anime) => window.__avCreateCard?.(anime) || '').join('');
      // Fallback: use the exported renderer through a temporary container
      if (html) grid.insertAdjacentHTML('beforeend', html);
      else grid.insertAdjacentHTML('beforeend', await cardsHtml(result.items));
    } else if (!result.items.length) {
      emptyState(grid, {
        title: 'No anime found',
        message: 'Try a shorter title, a different genre, or clear the year filter.',
        icon: 'fa-magnifying-glass'
      });
    } else {
      renderCards(grid, result.items);
    }

    updateCount(grid.querySelectorAll('.anime-card').length, result.hasNext);

    if (loadMoreBtn) {
      loadMoreBtn.hidden = !result.hasNext;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load more';
    }
    writeUrl();
    setBusy(grid, false);
  } catch (error) {
    console.warn('[AnimeVerse] Search failed:', error);
    if (append) toast(error.message || 'Could not load more results.', 'error');
    else errorState(grid, error.message);
    if (loadMoreBtn) {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Retry';
    }
  } finally {
    state.loading = false;
  }
}

/** Small helper so `append` can build cards without duplicating markup. */
async function cardsHtml(items) {
  const { createAnimeCard } = await import('./app.js');
  return items.map((anime) => createAnimeCard(anime)).join('');
}

/* ---------- Events ---------- */

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  readForm();
  state.page = 1;
  runSearch();
});

resetBtn?.addEventListener('click', () => {
  // Let the native reset happen, then clear state on the next tick.
  setTimeout(() => {
    readForm();
    state.page = 1;
    grid.innerHTML = '';
    if (countEl) countEl.textContent = 'Enter a search or pick a filter to begin.';
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    writeUrl();
  }, 0);
});

loadMoreBtn?.addEventListener('click', () => {
  state.page += 1;
  runSearch({ append: true });
});

[qInput, genreSelect, yearSelect, typeSelect, statusSelect, sortSelect].forEach((el) => {
  el?.addEventListener('change', debounce(() => {
    readForm();
    state.page = 1;
    runSearch();
  }, 250));
});

/* ---------- Boot ---------- */

async function init() {
  populateYears();
  readUrl();
  syncFormFromState();
  await populateGenres();
  syncFormFromState();

  const hasCriteria = state.q || state.genres || state.year || state.type || state.status;
  if (hasCriteria) runSearch();
  else if (countEl) countEl.textContent = 'Enter a search or pick a filter to begin.';
}

init();