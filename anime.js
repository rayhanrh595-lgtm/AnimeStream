// js/anime.js — anime details page
import { getAnime, getEpisodes, getRecommendations, escapeHtml } from './api.js';
import { renderCards, skeleton, emptyState, errorState, toast } from './app.js';
import { watchlist, favorites } from './storage.js';

const params = new URLSearchParams(window.location.search);
const animeId = params.get('id');

const els = {
  hero: document.getElementById('animeHero'),
  poster: document.getElementById('animePoster'),
  title: document.getElementById('animeTitle'),
  alt: document.getElementById('animeAlt'),
  genres: document.getElementById('animeGenres'),
  synopsisShort: document.getElementById('animeSynopsisShort'),
  synopsis: document.getElementById('animeSynopsis'),
  details: document.getElementById('animeDetails'),
  episodeGrid: document.getElementById('episodeGrid'),
  relatedRow: document.getElementById('relatedRow'),
  watchNow: document.getElementById('watchNowBtn'),
  watchlistBtn: document.getElementById('watchlistBtn'),
  favoriteBtn: document.getElementById('favoriteBtn')
};

function renderDetails(anime) {
  const rows = [
    ['Type', anime.type],
    ['Status', anime.status],
    ['Episodes', anime.episodes ? String(anime.episodes) : '—'],
    ['Aired', anime.year ? String(anime.year) : '—'],
    ['Season', anime.season || '—'],
    ['Studio', anime.studios?.length ? anime.studios.join(', ') : '—'],
    ['Score', Number.isFinite(anime.score) ? anime.score.toFixed(2) : '—'],
    ['Rank', anime.rank ? `#${anime.rank}` : '—'],
    ['Japanese title', anime.japaneseTitle || '—']
  ];

  els.details.innerHTML = rows.map(([label, value]) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
}

function renderEpisodes(anime, episodeList) {
  const grid = els.episodeGrid;
  if (!grid) return;

  let episodes = episodeList;

  // Fall back to a numbered list when the provider has no episode titles.
  if (!episodes.length && anime.episodes) {
    episodes = Array.from({ length: anime.episodes }, (_, index) => ({
      number: index + 1,
      title: `Episode ${index + 1}`
    }));
  }

  if (!episodes.length) {
    emptyState(grid, {
      title: 'No episode data',
      message: 'The metadata provider has not published episode information for this title.',
      icon: 'fa-list'
    });
    return;
  }

  grid.innerHTML = episodes.map((episode) => `
    <a class="episode-btn" href="watch.html?anime=${encodeURIComponent(anime.id)}&ep=${encodeURIComponent(episode.number)}">
      Episode ${escapeHtml(episode.number)}
      <span>${escapeHtml(episode.title || '')}</span>
    </a>`).join('');
  grid.removeAttribute('aria-busy');
}

function wireStorageButtons(anime) {
  const payload = {
    id: anime.id,
    title: anime.title,
    poster: anime.poster,
    year: anime.year,
    type: anime.type
  };

  const sync = () => {
    const saved = watchlist.has(anime.id);
    const fav = favorites.has(anime.id);
    if (els.watchlistBtn) {
      els.watchlistBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      const label = els.watchlistBtn.querySelector('span');
      if (label) label.textContent = saved ? 'In Watchlist' : 'Add to Watchlist';
    }
    if (els.favoriteBtn) {
      els.favoriteBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
      const label = els.favoriteBtn.querySelector('span');
      if (label) label.textContent = fav ? 'Favourited' : 'Favourite';
    }
  };

  els.watchlistBtn?.addEventListener('click', () => {
    const added = watchlist.toggle(payload);
    sync();
    toast(added ? 'Added to watchlist.' : 'Removed from watchlist.', 'success');
  });

  els.favoriteBtn?.addEventListener('click', () => {
    const added = favorites.toggle(payload);
    sync();
    toast(added ? 'Added to favourites.' : 'Removed from favourites.', 'success');
  });

  sync();
}

async function init() {
  if (!animeId || !/^\d+$/.test(animeId)) {
    if (els.hero) els.hero.setAttribute('aria-busy', 'false');
    if (els.title) els.title.textContent = 'Anime not specified';
    emptyState(els.episodeGrid, {
      title: 'No anime selected',
      message: 'Open a title from the homepage or search results.',
      icon: 'fa-link'
    });
    return;
  }

  document.title = 'Anime Details — AnimeVerse';

  try {
    const anime = await getAnime(animeId);
    if (!anime || !anime.id) throw new Error('This anime could not be found.');

    document.title = `${anime.title} — AnimeVerse`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', (anime.synopsis || anime.title).slice(0, 155));

    if (els.poster) {
      els.poster.src = anime.poster || '';
      els.poster.alt = `${anime.title} poster`;
    }
    if (els.title) els.title.textContent = anime.title;
    if (els.alt) {
      els.alt.textContent = [anime.japaneseTitle, anime.originalTitle]
        .filter(Boolean)
        .filter((value) => value !== anime.title)
        .join(' · ');
    }
    if (els.genres) {
      els.genres.innerHTML = anime.genres
        .map((genre) => `<span class="chip">${escapeHtml(genre)}</span>`)
        .join('');
    }
    if (els.synopsisShort) els.synopsisShort.textContent = anime.synopsis || 'No synopsis available.';
    if (els.synopsis) els.synopsis.textContent = anime.synopsis || 'No synopsis available.';
    if (els.watchNow) els.watchNow.href = `watch.html?anime=${encodeURIComponent(anime.id)}&ep=1`;

    renderDetails(anime);
    wireStorageButtons(anime);
    els.hero?.setAttribute('aria-busy', 'false');

    // Episodes + related in parallel (both are queued/rate-limited internally).
    const [episodeResult, related] = await Promise.all([
      getEpisodes(anime.id).catch(() => ({ episodes: [] })),
      getRecommendations(anime.id).catch(() => [])
    ]);

    renderEpisodes(anime, episodeResult.episodes || []);

    if (els.relatedRow) {
      if (related.length) renderCards(els.relatedRow, related);
      else emptyState(els.relatedRow, {
        title: 'No related titles',
        message: 'The metadata provider returned no recommendations.',
        icon: 'fa-link'
      });
    }
  } catch (error) {
    console.warn('[AnimeVerse] Details failed:', error);
    if (els.title) els.title.textContent = 'Unable to load this anime';
    errorState(els.episodeGrid, error.message);
    if (els.relatedRow) errorState(els.relatedRow, '');
    els.hero?.setAttribute('aria-busy', 'false');
  }
}

init();