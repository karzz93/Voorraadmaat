# Voorraadmaat

Voorraadmaat is a local-first grocery inventory and weekly meal planner that can be installed on Android as a Progressive Web App (PWA). It is designed to be hosted for free on GitHub Pages.

The interface is in Dutch because the first supermarket integrations target the Netherlands.

## What is included

- Import a grocery list by pasting text, choosing a `.txt` or `.md` file, or sharing text from Samsung Notes to the installed PWA.
- Parse common Dutch list formats such as `2x melk`, `1,5 kg aardappelen`, `bananen 6`, bullets, and checkboxes.
- Merge imported products into a persistent local inventory.
- Mark a product as fully used or adjust its quantity.
- Rank a built-in recipe library by how much of each recipe is already in stock.
- Generate a five-recipe week proposal, configurable from one to seven recipes.
- Mark a recipe as cooked and deduct its ingredients from inventory.
- Generate missing ingredients from the planned recipes.
- Match shopping items to active deals and group the list by Albert Heijn, Dirk, Lidl, Hoogvliet, and PLUS.
- Mark a shopping item as bought and move it into inventory.
- Work offline after the first successful load.
- Export and import a JSON backup.
- Refresh deal data on a schedule through GitHub Actions.

## Publish it on GitHub Pages

### 1. Create the repository

Create a new GitHub repository, for example `voorraadmaat`. A public repository works with GitHub Pages on GitHub Free.

Upload the complete contents of this folder, including the hidden `.github` directory, to the repository's `main` branch. With Git installed, the equivalent commands are:

```bash
git init
git add .
git commit -m "Initial Voorraadmaat app"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/voorraadmaat.git
git push -u origin main
```

### 2. Enable Pages

In the repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open **Actions** and allow the `Deploy Voorraadmaat to GitHub Pages` workflow to finish.

The app will normally be available at:

```text
https://YOUR-NAME.github.io/voorraadmaat/
```

The workflow validates the parser and recipe engine, attempts to refresh current deals, and deploys only the `site` directory.

### 3. Install on Android

1. Open the GitHub Pages address in Chrome on Android.
2. Open Chrome's menu.
3. Choose **Install app** or **Add to Home screen**.
4. Launch Voorraadmaat from the new home-screen icon.

After installation, Android can register the PWA as a text share target.

### 4. Share a Samsung Note

1. Open the grocery note in Samsung Notes.
2. Tap **Share**.
3. Choose **Text** when Samsung Notes asks for a format.
4. Select **Voorraadmaat** in Android's share sheet.
5. Review the parsed products and tap **Voeg toe aan voorraad**.

If Voorraadmaat does not appear in the share sheet, confirm that it was installed as an app rather than opened only as a browser tab. Copying and pasting the note into the import dialog always remains available.

## Deal data

The default integration uses the public PrijsProfeet deal API rather than scraping five retailer websites directly. Its free public endpoints cover the requested stores and avoid placing CORS-sensitive scraper code in the Android app.

The UI includes the attribution required by the free API tier. See:

- https://www.prijsprofeet.nl/api
- https://www.prijsprofeet.nl/docs

Two workflows are included:

- `.github/workflows/deploy-pages.yml` refreshes deals for each deployment.
- `.github/workflows/refresh-deals.yml` refreshes `site/data/deals.json` daily, commits changes when the feed differs, and redeploys the refreshed site.

The public endpoints work without a key. For a higher per-key limit, request a free key from PrijsProfeet and add it as a repository secret named:

```text
PRIJS_PROFEET_API_KEY
```

Add the secret under **Settings → Secrets and variables → Actions**. Do not put an API key in `site/`, JavaScript, or the Git history.

The fetcher is deliberately tolerant of several JSON response shapes. It preserves the previous deal file when a refresh fails, so inventory and recipes remain usable.

### Why direct supermarket scraping is not the default

A GitHub Pages app is static and cannot reliably scrape retailer sites from the browser because of CORS, anti-bot controls, dynamic rendering, and frequent markup changes. A scheduled GitHub Action can run scrapers, but each retailer adapter then becomes an ongoing maintenance task and must comply with the retailer's terms and robots policy.

`scripts/fetch-deals.mjs` is the provider boundary. A later direct scraper can write the same normalized schema to `site/data/deals.json` without changing the app:

```json
{
  "meta": {
    "status": "live",
    "generatedAt": "2026-07-18T04:17:00.000Z"
  },
  "deals": [
    {
      "id": "unique-id",
      "retailer": "dirk",
      "name": "Product name",
      "price": 1.99,
      "originalPrice": 2.99,
      "discountPercentage": 33,
      "quantity": "500 g",
      "validFrom": "2026-07-15",
      "validUntil": "2026-07-21"
    }
  ]
}
```

Supported retailer keys are `albert_heijn`, `dirk`, `lidl`, `hoogvliet`, and `plus`.

## Run locally

No dependency installation is required. Node 20 or newer is needed for the tests and deal fetcher.

```bash
npm test
npm start
```

Then open `http://localhost:4173`.

To attempt a deal refresh locally:

```bash
npm run fetch-deals
```

The app must be served over `https://` or `localhost` for service workers and installation. Opening `site/index.html` directly as a local file is not sufficient.

## Data and privacy

Inventory, settings, the week plan, the shopping list, and activity history are stored in the browser's local storage. There is no account and no household data is sent to GitHub or the deal provider.

Consequences of this design:

- The same inventory does not automatically appear on a second phone.
- Clearing browser site data removes the inventory.
- Use **Settings → Back-up → Exporteer** before changing phones or clearing browser data.
- A private/incognito session may not preserve data reliably.

## Current limitations

- Samsung Notes should be shared as text. PDF, image, and handwriting OCR are not included in this version.
- Recipe matching uses a curated local recipe library and Dutch synonym rules; it is not a generative AI service.
- Quantities are normalized to pieces/packages, grams, or millilitres. “One package” cannot always be converted to a recipe's grams without product-specific package metadata.
- Deal matching is fuzzy name matching. Always check the exact product, quantity, validity period, loyalty-card requirements, and in-store price.
- The route chooses the cheapest matching active deal that is present in the feed. It does not yet optimize fuel cost, store distance, regular non-deal prices, minimum quantities, or personalized offers such as Mijn Bonus Box.
- Data is single-device until a sync backend is added.

## Project structure

```text
site/
  index.html                 App shell
  styles.css                 Responsive UI
  manifest.webmanifest       Android install and Samsung Notes share target
  sw.js                      Offline cache
  js/core.js                 Parser, inventory, recipes, deal matching
  js/recipes.js              Local recipe library
  js/app.js                  UI and local persistence
  data/deals.json            Normalized deal feed
scripts/fetch-deals.mjs      Scheduled deal provider adapter
tests/core.test.mjs          Parser and planning tests
.github/workflows/           Pages deploy and deal refresh
```

## Sensible next upgrades

1. Optional household sync through Supabase or Firebase, with sign-in and row-level access rules.
2. Camera receipt import or on-device OCR for Samsung Notes images and paper receipts.
3. Product package-size metadata and barcode scanning for more accurate deductions.
4. Expiry dates and “use first” recipe weighting.
5. Travel-aware store optimization using a postcode and a configurable cost per kilometre.
6. Custom recipe import and dietary/allergy filters.

## License

MIT. Deal data remains subject to the provider's terms and retailer price information should always be verified.
