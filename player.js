// js/player.js — watch page: episode navigation, playback adapter, local progress
import { CONFIG, getAnime, getEpisodes, getRecommendations, streaming, escapeHtml, safeUrl } from './api.js';
import { renderCards, skeleton, emptyState, errorState, toast } from './app.js';
import { continueWatching, progress } from './storage.js';

const params = new URLSearchParams(window.location.search);
const animeId = params.get('anime');
let currentEp = Math.max(1, Number(params.get('ep')) || 1);

const shell = document.getElementById('playerShell');
const titleEl = document.getElementById('watchTitle');
const metaEl = document.getElementById('watchMeta');
const selectEl = document.getElementById('episodeSelect');
const prevEl = document.getElementById('prevEp');
const nextEl = document.getElementById('nextEp');
const noteEl = document.getElementById('watchNote');
const relatedGrid = document.getElementById('relatedGrid');

let anime = null;
let episodeNumbers = [];

/* ------------------------------------------------------------------
   DEMO ONLY: a public sample clip, shown because no licensed provider
   is configured. It is NOT anime content. Remove by setting
   CONFIG.demoMode = false in js/api.js once a provider is wired up.
   ------------------------------------------------------------------ */
const DEMO_SAMPLE_MP4 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

/* ---------- Player rendering ---------- */

function showMessage(icon, heading, body) {
  if (!shell) return;
  shell.innerHTML = `
    <div class="player-message">
      <i class="fas ${icon}" aria-hidden="true"></i>
      <h2>${escapeHtml(heading)}</h2>
      <p>${body}</p>
    </div>`;
  shell.setAttribute('aria-busy', 'false');
}

function mountEmbed(url) {
  shell.innerHTML = `
    <iframe
      src="${escapeHtml(url)}"
      title="Anime episode player"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowfullscreen
      referrerpolicy="origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups"
      loading="lazy"></iframe>`;
  shell.setAttribute('aria-busy', 'false');
}

function mountDemoVideo(episodeLabel) {
  shell.innerHTML = `
    <div class="demo-banner">DEMO PLACEHOLDER — sample clip, not anime content</div>
    <video id="demoVideo" controls playsinline preload="metadata" crossorigin="anonymous">
      <source src="${DEMO_SAMPLE_MP4}" type="video/mp4">
      Your browser does not support HTML5 video.
    </video>`;
  shell.setAttribute('aria-busy', 'false');

  const video = document.getElementById('demoVideo');
  if (!video) return;

  // Resume from saved progress
  const saved = progress.get(animeId, currentEp);
  if (saved && saved.seconds > 15) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn btn-ghost';
    resume.style.marginTop = '0.75rem';
    resume.innerHTML = `<i class="fas fa-rotate-right" aria-hidden="true"></i> Resume from ${formatTime(saved.seconds)}`;
    resume.addEventListener('click', () => {
      video.currentTime = saved.seconds;
      video.play().catch(() => {});
      resume.remove();
    });
    noteEl.appendChild(resume);
  }

  let lastSave = 0;
  video.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastSave < 5000) return;
    lastSave = now;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      progress.set(animeId, currentEp, video.currentTime, video.duration);
    }
  });

  video.addEventListener('pause', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      progress.set(animeId, currentEp, video.currentTime, video.duration);
    }
  });

  video.addEventListener('error', () => {
    showMessage('fa-triangle-exclamation', 'Playback error',
      'The demo sample could not be loaded. Check your connection or disable any content blocker.');
  });

  video.addEventListener('ended', () => {
    const index = episodeNumbers.indexOf(currentEp);
    const nextNumber = episodeNumbers[index + 1];
    if (nextNumber) {
      toast(`Playing next episode (${nextNumber})…`, 'info');
      window.location.href = `watch.html?anime=${encodeURIComponent(animeId)}&ep=${nextNumber}`;
    }
  });

  // Keep the episode label handy for screen readers
  shell.setAttribute('aria-label', `Demo player — ${episodeLabel}`);
}

async function mountPlayer(episodeLabel) {
  shell.setAttribute('aria-busy', 'true');
  shell.innerHTML = '<div class="player-loading"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Checking playback availability…</div>';

  const episodeId = `${animeId}-ep-${currentEp}`;

  try {
    const embed = await streaming.getEmbedUrl(episodeId);
    if (embed.ok && embed.url) {
      mountEmbed(embed.url);
      return;
    }

    if (CONFIG.demoMode) {
      mountDemoVideo(episodeLabel);
      return;
    }

    showMessage('fa-lock', 'Playback unavailable',
      'No authorised streaming provider is configured for this episode. ' +
      'AnimeVerse never hosts or scrapes video content. See <code>README.md</code> → ' +
      '“Streaming provider integration” to connect a licensed provider.');
  } catch (error) {
    console.warn('[AnimeVerse] Player adapter failed:', error);
    showMessage('fa-triangle-exclamation', 'Playback error',
      escapeHtml(error.message || 'The playback source could not be resolved.'));
  }
}

/* ---------- Helpers ---------- */

function formatTime(seconds) {
  const total = Math.floor(seconds || 0);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function updateNavLinks() {
  const index = episodeNumbers.indexOf(currentEp);
  const prevNumber = index > 0 ? episodeNumbers[index - 1] : null;
  const nextNumber = index >= 0 && index < episodeNumbers.length - 1 ? episodeNumbers[index + 1] : null;

  if (prevEl) {
    prevEl.href = prevNumber
      ? `watch.html?anime=${encodeURIComponent(animeId)}&ep=${prevNumber}`
      : '#';
    prevEl.setAttribute('aria-disabled', prevNumber ? 'false' : 'true');
  }
  if (nextEl) {
    nextEl.href = nextNumber
      ? `watch.html?anime=${encodeURIComponent(animeId)}&ep=${nextNumber}`
      : '#';
    nextEl.setAttribute('aria-disabled', nextNumber ? 'false' : 'true');
  }
}

function renderEpisodeSelect() {
  if (!selectEl) return;
  selectEl.innerHTML = episodeNumbers
    .map((number) => `<option value="${number}"${number === currentEp ? ' selected' : ''}>Episode ${number}</option>`)
    .join('');

  selectEl.addEventListener('change', () => {
    const value = Number(selectEl.value);
    if (!Number.isFinite(value) || value === currentEp) return;
    window.location.href = `watch.html?anime=${encodeURIComponent(animeId)}&ep=${value}`;
  });
}

function saveContinue() {
  if (!anime) return;
  continueWatching.save({
    animeId: anime.id,
    title: anime.title,
    poster: anime.poster,
    episode: currentEp,
    total: episodeNumbers.length || anime.episodes || null
  });
}

function renderNote() {
  if (!noteEl) return;
  noteEl.innerHTML = '';

  const sources = streaming.isConfigured()
    ? ''
    : `<p class="notice notice-info">
         No licensed streaming provider is configured, so playback uses a demo sample clip.
         Audio and subtitle languages are shown only when a provider verifies them.
         See <code>README.md</code> for the adapter contract.
       </p>`;
  noteEl.insertAdjacentHTML('beforeend', sources);
}

/* ---------- Boot ---------- */

async function init() {
  if (!animeId || !/^\d+$/.test(animeId)) {
    if (titleEl) titleEl.textContent = 'No anime selected';
    showMessage('fa-link', 'Nothing to play',
      'Open an episode from an anime page, or browse the catalogue first.');
    emptyState(relatedGrid, { title: 'No related titles', message: 'Pick an anime first.', icon: 'fa-link' });
    return;
  }

  if (titleEl) titleEl.textContent = 'Loading…';
  skeleton(relatedGrid, 4);

  try {
    anime = await getAnime(animeId);
    if (!anime || !anime.id) throw new Error('This anime could not be loaded.');

    document.title = `Episode ${currentEp} · ${anime.title} — AnimeVerse`;
    if (titleEl) titleEl.textContent = `${anime.title} — Episode ${currentEp}`;
    if (metaEl) {
      metaEl.innerHTML = [
        anime.type ? `<span><i class="fas fa-tv" aria-hidden="true"></i> ${escapeHtml(anime.type)}</span>` : '',
        anime.status ? `<span><i class="fas fa-signal" aria-hidden="true"></i> ${escapeHtml(anime.status)}</span>` : '',
        anime.episodes ? `<span><i class="fas fa-list" aria-hidden="true"></i> ${escapeHtml(anime.episodes)} episodes</span>` : '',
        Number.isFinite(anime.score) ? `<span><i class="fas fa-star" aria-hidden="true"></i> ${anime.score.toFixed(1)}</span>` : ''
      ].filter(Boolean).join('');
    }

    const episodeResult = await getEpisodes(anime.id).catch(() => ({ episodes: [] }));
    const listed = (episodeResult.episodes || []).map((ep) => ep.number);

    if (listed.length) {
      episodeNumbers = listed;
    } else if (anime.episodes) {
      episodeNumbers = Array.from({ length: anime.episodes }, (_, i) => i + 1);
    } else {
      episodeNumbers = [1];
    }

    if (!episodeNumbers.includes(currentEp)) {
      currentEp = episodeNumbers[0] ?? 1;
    }

    renderEpisodeSelect();
    updateNavLinks();
    saveContinue();
    renderNote();
    await mountPlayer(`Episode ${currentEp}`);

    const related = await getRecommendations(anime.id, 8).catch(() => []);
    if (related.length) renderCards(relatedGrid, related);
    else emptyState(relatedGrid, {
      title: 'No related titles',
      message: 'The metadata provider returned no recommendations.',
      icon: 'fa-link'
    });
  } catch (error) {
    console.warn('[AnimeVerse] Watch page failed:', error);
    if (titleEl) titleEl.textContent = 'Unable to load this episode';
    showMessage('fa-triangle-exclamation', 'Could not load episode',
      escapeHtml(error.message || 'Please try again in a moment.'));
    errorState(relatedGrid, '');
  }
}

init();