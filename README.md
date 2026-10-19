# PixelPlay Arcade

A premium, dark-themed 2D browser arcade built as a **static website**.

* Six original games, all implemented in `script.js` and rendered on HTML5 canvas
* A JSON catalog (`games.json`) that drives every grid, category and search result
* Favourites and recently-played history saved in `localStorage`
* A Python importer (`import_games.py`) that safely merges new records into the catalog
* Deployable to GitHub Pages with no backend and no build step

---

## 1. Project files

The project deliberately uses **exactly one file per file type**:

| File | Purpose |
| --- | --- |
| `index.html` | The whole site: header, hero, library, favourites, recent, info pages, game player, footer |
| `style.css` | All styling, responsive breakpoints, animations and state styles |
| `script.js` | All front-end logic **and** the six built-in canvas games |
| `icon.svg` | The site logo, also used as the favicon |
| `games.json` | The game catalog |
| `import_games.py` | Local Python tool that validates and merges catalog entries |
| `README.md` | This document |

There are no `styles/`, `scripts/` or `components/` folders, and no extra JS or CSS files.

---

## 2. Requirements

* A modern browser (Chrome, Edge, Firefox or Safari)
* **Python 3.9+** — only for running the importer and for the optional local web server
* No Node.js, no package manager, no build tools

---

## 3. Running the site locally

### 3.1 Why you need a local server

`script.js` loads the catalog with:

```js
fetch("games.json");