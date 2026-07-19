# Live deals upgrade

The app now searches live offers through:

`https://voorraadkast-deals.karsmorsink.workers.dev`

## Changed files

- `site/js/deals-api.js`: Worker client with a 30-minute local cache.
- `site/js/app.js`: live searches for shopping-list products and manual deal searches.
- `site/js/deals-engine.js`: reused for one-store/two-store optimization.
- `site/sw.js`: cache version updated and live-deal modules added to the app shell.
- `package.json`: old deal-fetch script removed.

## Deployment

Keep only `.github/workflows/deploy-pages.yml`. Commit the files to `main`; GitHub Pages should deploy automatically.

The old static `site/data/deals.json` is no longer used by the app. It can remain as historical fallback data or be deleted later.
