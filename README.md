# book-recs

## Why

**I couldn't easily see which next books exist in the series I loved.** My books live in Goodreads, Kindle and Readwise Books, and none of them shows that. Readwise Books has my library and ratings but no series catalog, so I borrowed [Hardcover](https://hardcover.app)'s. I'd drop it once the Readwise API exposes that data.

## What

**A local page that tells me what to read next**, from the books I rated 5★ in [Readwise Books](https://readwise.io/books_api):

- **The next book in each series I loved.** One per series, the first after where I stopped (main series, whole positions only: #1.5 is usually a short story).
- **Other books by authors I loved.** Standalones, or #1 of a series I haven't started.

Only books that are already out. Each card has a label for how much of my reading backs it:

- "Strong match" means 2+ of my books in that series (or by that author), at least three quarters of them 5★.
- "Promising" means the evidence is mixed.
- "Limited evidence" means one book. Those are hidden for author picks and kept for series sequels.

The more books I loved, the higher a card sits: four loved books beat one.

![The page at desktop width](docs/screenshot-desktop.png)

## How it works

```
Readwise Books ──► match each book on Hardcover ──► loved = finished and rated 5★
(+ Audible export)   (title + author, or ISBN)               │
                                                   ┌─────────┴──────────┐
                                                   series I loved     authors I loved
                                                   next unread book   other books
                                                   └─────────┬──────────┘
                                          keep: already out
                                          label: how many of my books back it
                                          sort: rises with every loved book
                                                             │
                                                      out/index.html
```

- `src/readwise.mjs` and `src/audible.mjs` load the library. `src/match.mjs` finds each book on Hardcover (most of my Goodreads imports have no ISBN, so this matters most).
- `src/recommend.mjs` picks and filters. `src/model.mjs` sorts by a cautious estimate of my 5★ rate per series or author; a small model trained on my ratings breaks ties and hides the weakest. Neither uses Hardcover's community rating, which didn't predict mine.
- `src/render.mjs` writes one static page. No dependencies, Node 26 (`nvm use`).

## Run it

1. Put your [Readwise token](https://readwise.io/access_token) in `api-key.txt` (needs Readwise Books access, or you get a 403).
2. Put your [Hardcover token](https://hardcover.app/account/api) in `hardcover-key.txt`, or set `HARDCOVER_TOKEN`.
3. Run `npm start`, then `npm run open`.

The first run takes about 6 minutes (Hardcover allows 60 requests a minute). After that, searches come from `data/hc-cache/` and catalog data refreshes weekly. The "loved" bar is `LOVED` in `src/model.mjs`. To hide a book for good, add its Hardcover id to `skip.json` (I use it for catalog errors, like two authors merged under one name).

### Add Audible (optional)

**Audible has no API, so this is manual.** It stops finished or abandoned audiobooks from coming back as suggestions.

1. Sign in at [audible.com/library/titles](https://www.audible.com/library/titles) in Chrome.
2. Paste `scripts/audible-export.js` into the DevTools console (`Cmd+Option+J`) and press Enter. It copies your library and purchase dates to the clipboard; nothing leaves your browser.
3. Save the clipboard as `data/audible.json`, then run `npm start`.

An unfinished audiobook counts as did-not-finish after 6 months. Audible Plus and gifts have no purchase date, so set `dnfFrom` to a title: it and every older unfinished one count as did-not-finish. If a book is in both libraries, Readwise wins on ratings and the furthest status wins. `data/` is gitignored.

## Learnings

Here's the story, including the bits where I was confidently wrong (each fix has a comment in the code):

- Hardcover's search ranks "Summary of Atomic Habits by James Clear" above the real book, so the matcher retries with the title alone.
- God Emperor of Dune lists "Dune" as an alternate title, so exact titles win.
- Hardcover keeps duplicate books and even duplicate series. A position counts as read if any copy of it is.
- Murderbot books are novellas, so a "books only" filter would hide them.
- Some release dates are wrong, some imprints show up as series, and some contributors are credited as authors.
- Hardcover's community rating didn't predict my ratings at all. Goodreads' might, but its API closed in 2020.
- It's built for one library on one machine. Tokens, cache and the page stay local, and Hardcover's API is for personal, non-commercial use.

Claude wrote most of the code. I steered it, with care to always ground it in data: every fix above came from a run against my real library, not from a guess.
