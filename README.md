# book-recs

A local page that tells me what to read next. It looks at the books I loved in [Readwise Books](https://readwise.io/books_api) and finds two kinds of books on [Hardcover](https://hardcover.app):

- **The next book in each series I loved.** One per series: the first one after where I stopped.
- **Other books by authors I loved.** Standalones, or the first book of a series I haven't started.

It only suggests books that are already out. Each card shows a confidence %, which is the chance I'd love the book, estimated from how I rated everything else. Books under 50% don't show.

![The page at desktop width](docs/screenshot-desktop.png)

## Why

My books live in three places: Goodreads, Kindle (Amazon) and Readwise Books. None of them gave me an easy way to see which next books exist in the series I already loved. Readwise Books has my library and my ratings, but no catalog of series. So I added Hardcover for its catalog. I hope to drop it and use only Readwise Books once its API exposes that data.

## How it works

```
Readwise Books ──► match each book on Hardcover ──► loved = finished and rated 5★
(my library,         (search by title + author,             │
 with my ratings)     checked against the ISBN    ┌─────────┴──────────┐
                      or the author's last name)  series I loved     authors I loved
                                                  next unread book   other books
                                                  └─────────┬──────────┘
                                         keep: already out
                                         add: confidence % from a model trained on my ratings
                                         keep: 50% or more
                                                            │
                                                     out/index.html
```

1. `src/readwise.mjs` pulls the whole library, ratings included. `src/audible.mjs` adds an Audible export if you have one (see below).
2. `src/match.mjs` finds each book on Hardcover. Readwise has no series data, and most of my Goodreads imports have no ISBN, so this match matters most.
3. `src/recommend.mjs` picks the candidates and filters them.
4. `src/model.mjs` trains a small logistic regression on my rated books. It predicts "rated 5★" from my ratings of the same author, my ratings of the same series, and the book's Hardcover rating.
5. `src/render.mjs` writes one static HTML page.

There are no dependencies, just Node's built-in `fetch`. It needs Node 26 (the current LTS); with nvm, run `nvm use` in the repo.

## Run it

1. Put your Readwise token (from [readwise.io/access_token](https://readwise.io/access_token)) in `api-key.txt`. You need Readwise Books access, or the API returns 403.
2. Put your Hardcover token (from [hardcover.app/account/api](https://hardcover.app/account/api)) in `hardcover-key.txt`, or set `HARDCOVER_TOKEN`.
3. Run `npm start`, then `npm run open`.

The first run takes about 6 minutes, because Hardcover's free API allows 60 requests a minute. After that it's quick: search results are cached in `data/hc-cache/`, and series and author data refreshes once a week.

The "loved" bar is `LOVED` at the top of `src/model.mjs`. I don't filter on Hardcover's community rating: it didn't predict my ratings.

### Add your Audible library (optional)

Audible has no API, so this step is manual. It makes audiobooks you finished or abandoned count as read, so they don't show up as recommendations.

1. Sign in at [audible.com/library/titles](https://www.audible.com/library/titles) in Chrome.
2. Open DevTools (`Cmd+Option+J` on a Mac), paste the contents of `scripts/audible-export.js` into the console, and press Enter. It reads your library pages and purchase history, then copies the result to your clipboard. Nothing leaves your browser.
3. Save the clipboard as `data/audible.json`.
4. Run `npm start` again.

An unfinished audiobook counts as did-not-finish once it's over 6 months old. Titles from Audible Plus or gifts have no purchase date, so you can also set `dnfFrom` in `data/audible.json` to a title: that title and every unfinished one added before it count as did-not-finish. Where a book is in both libraries, Readwise wins on ratings and the furthest status wins (finished, then did-not-finish, then reading). `data/` is gitignored, so your library stays on your machine.

To hide a book for good, add its Hardcover id to `skip.json`. I use it for catalog errors, like Hardcover merging two different authors who share a name.

## What my library broke

Here's the story, including the bits where I was confidently wrong. Each fix has a comment in the code.

- Hardcover's search ranks "Summary of Atomic Habits by James Clear" knock-offs above the real book, so the matcher retries with the title alone.
- God Emperor of Dune lists "Dune" as an alternate title, so exact matches on the real title win.
- Hardcover keeps duplicate books (translations, editions) and even duplicate series. A position counts as read if any copy at that position is a book I read.
- Murderbot books are filed as novellas, so a "books only" filter would hide them.

## Limits

- Goodreads ratings would be a better community signal, but Goodreads closed its API in 2020.
- Hardcover's data has gaps: some release dates are wrong, some publisher imprints show up as series, and a few books credit contributors as authors.
- It's built for one person's library on one machine. Your tokens, cache and the generated page stay local (`.gitignore` covers them).
- Hardcover's API is for personal, non-commercial use.

Claude wrote most of the code. I steered it, with care to always ground it in data: every fix above came from a run against my real library, not from a guess.
