// js/storage.js — device-local persistence helpers
// All data lives in this browser only. Nothing is uploaded.

const NS = 'av';

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`${NS}:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try { localStorage.removeItem(`${NS}:${key}`); } catch { /* ignore */ }
}

/* ---------- Watchlist ---------- */
export const watchlist = {
  list() { return read('watchlist', []); },
  has(id) { return this.list().some((item) => String(item.id) === String(id)); },
  add(anime) {
    const list = this.list().filter((item) => String(item.id) !== String(anime.id));
    list.unshift(anime);
    return write('watchlist', list.slice(0, 200));
  },
  remove(id) {
    return write('watchlist', this.list().filter((item) => String(item.id) !== String(id)));
  },
  toggle(anime) {
    if (this.has(anime.id)) { this.remove(anime.id); return false; }
    this.add(anime); return true;
  }
};

/* ---------- Favourites ---------- */
export const favorites = {
  list() { return read('favorites', []); },
  has(id) { return this.list().some((item) => String(item.id) === String(id)); },
  toggle(anime) {
    const list = this.list();
    const exists = list.some((item) => String(item.id) === String(anime.id));
    if (exists) {
      write('favorites', list.filter((item) => String(item.id) !== String(anime.id)));
      return false;
    }
    list.unshift(anime);
    write('favorites', list.slice(0, 200));
    return true;
  }
};

/* ---------- Continue watching ---------- */
export const continueWatching = {
  list() { return read('continue', []); },
  save(entry) {
    const list = this.list().filter((item) => String(item.animeId) !== String(entry.animeId));
    list.unshift({ ...entry, updatedAt: Date.now() });
    return write('continue', list.slice(0, 30));
  },
  get(animeId) { return this.list().find((item) => String(item.animeId) === String(animeId)) || null; },
  remove(animeId) {
    return write('continue', this.list().filter((item) => String(item.animeId) !== String(animeId)));
  },
  clear() { return write('continue', []); }
};

/* ---------- Playback progress (per anime + episode) ---------- */
export const progress = {
  all() { return read('progress', {}); },
  get(animeId, episode) {
    const all = this.all();
    return all[`${animeId}:${episode}`] || null;
  },
  set(animeId, episode, seconds, duration) {
    const all = this.all();
    all[`${animeId}:${episode}`] = { seconds, duration, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 120) {
      keys.sort((a, b) => all[a].at - all[b].at)
        .slice(0, keys.length - 120)
        .forEach((k) => delete all[k]);
    }
    return write('progress', all);
  },
  clear(animeId, episode) {
    const all = this.all();
    delete all[`${animeId}:${episode}`];
    return write('progress', all);
  }
};

/* ---------- Preferences / profile ---------- */
export const prefs = {
  get() {
    return read('prefs', { displayName: '', audio: 'japanese', subs: 'english' });
  },
  set(patch) {
    return write('prefs', { ...this.get(), ...patch });
  }
};