// js/categories.js — genre / type / status browsing hubs
import { getGenres, fetchTopAnime, escapeHtml } from './api.js';
import { renderCards, skeleton, errorState } from './app.js';

const genreGrid = document.getElementById('genreGrid');
const popularGrid = document.getElementById('popularGrid');

const TYPES = [
  { label: 'TV Series', value: 'tv', icon: 'fa-tv' },
  { label: 'Movies', value: 'movie', icon: 'fa-film' },
  { label: 'OVA', value: 'ova', icon: 'fa-compact-disc' },
  { label: 'ONA', value: 'ona', icon: 'fa-globe' },
  { label: 'Specials', value: 'special', icon: 'fa-star' }
];

const STATUS = [
  { label: 'Currently Airing', href: 'search.html?status=airing', icon: 'fa-tower-broadcast' },
  { label: 'Completed', href: 'search.html?status=complete', icon: 'fa-circle-check' },
  { label: 'Upcoming', href: 'search.html?status=upcoming', icon: 'fa-calendar-days' },
  { label: 'Top Rated', href: 'search.html?sort=rating', icon: 'fa-trophy' },
  { label: 'Newest', href: 'search.html?sort=newest', icon: 'fa-bolt' },
  { label: 'Most Popular', href: 'search.html?sort=popularity', icon: 'fa-fire' }
];

function renderTypes() {
  const grid = document.getElementById('typeGrid');
  if (!grid) return;
  grid.innerHTML = TYPES.map((type) => `
    <a class="tile" href="search.html?type=${encodeURIComponent(type.value)}">
      <i class="fas ${type.icon}" aria-hidden="true"></i>${escapeHtml(type.label)}
    </a>`).join('');
}

function renderStatus() {
  const grid = document.getElementById('statusGrid');
  if (!grid) return;
  grid.innerHTML = STATUS.map((item) => `
    <a class="tile" href="${escapeHtml(item.href)}">
      <i class="fas ${item.icon}" aria-hidden="true"></i>${escapeHtml(item.label)}
    </a>`).join('');
}

async function renderGenres() {
  if (!genreGrid) return;
  genreGrid.innerHTML = '<div class="skeleton skeleton-line"></div>'.repeat(8);
  try {
    const genres = await getGenres();
    if (!genres.length) {
      genreGrid.innerHTML = '<p class="notice">No genres returned by the metadata provider.</p>';
      return;
    }
    genreGrid.innerHTML = genres.map((genre) => `
      <a class="genre-tile" href="search.html?genres=${encodeURIComponent(genre.id)}">
        <span>${escapeHtml(genre.name)}</span>
        <span class="count">${Number.isFinite(genre.count) ? genre.count : ''}</span>
      </a>`).join('');
  } catch (error) {
    genreGrid.innerHTML = `<p class="notice notice-error">${escapeHtml(error.message || 'Could not load genres.')}</p>`;
  }
}

async function renderPopular() {
  if (!popularGrid) return;
  skeleton(popularGrid, 12);
  try {
    const items = await fetchTopAnime({ limit: 12 });
    renderCards(popularGrid, items);
  } catch (error) {
    errorState(popularGrid, error.message);
  }
}

renderTypes();
renderStatus();
renderGenres();
renderPopular();