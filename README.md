# 591 Local Viewer Prototype

This prototype turns pasted 591 search-result pages into a compact local viewer.

## Workflow

1. Put pasted result pages in [`data/raw`](./data/raw) using the filename format `YYYY-MM-DD_城市.txt`.
2. Optional: map listings to item pages in [`data/photo-targets.txt`](./data/photo-targets.txt) using `title substring | https://rent.591.com.tw/<id>`.
3. Optional: import item links from one or more live 591 search-result pages.
   PowerShell-safe form: `node scripts/import-photo-targets.mjs '<591 list url>'`
   All pages from one search: `node scripts/import-photo-targets.mjs --all-pages '<591 list url>'`
   Bash or escaped Windows form: `npm run import-targets -- "<591 list url>"`
4. Optional: generate live code lookups for `region`, `kind`, `section`, and `circle`.
   PowerShell-safe form: `node scripts/scrape-591-taxonomy.mjs '<591 list url>'`
   NPM form: `npm run scrape-taxonomy -- '<591 list url>'`
   Output file: [`data/591-taxonomy.generated.json`](./data/591-taxonomy.generated.json)
5. Optional: use the stored taxonomy JSON to list codes or generate 591 search URLs by name.
   Detailed helper: `node scripts/resolve-591-url.mjs --region 台東縣 --kind 獨立套房 --section 台東市 --page 2`
   Quick wrapper: `node scripts/quick-591-url.mjs taitung studio taitungcity 2`
   NPM forms: `npm run query-591 -- --region 台東縣 --kind 獨立套房 --section 台東市` and `npm run quick-591 -- taitung studio taitungcity 2`
6. After editing raw text files, run `npm run build` to regenerate the data.
7. Run `npm run refresh` if you also want to refresh photo downloads.
8. Open [`index.html`](./index.html) directly, or run `npm run start` and open `http://localhost:4173`.

## Notes

- The plain pasted search page does not include stable listing IDs or item URLs.
- Because of that, card extraction is automatic, but photo grabbing is only semi-automatic unless you paste richer source data later.
- `node scripts/import-photo-targets.mjs '<591 list url>'` reads the live search page, extracts item links, matches them to your current local listings, and appends exact `listing id | item url` rows to [`data/photo-targets.txt`](./data/photo-targets.txt).
- `node scripts/import-photo-targets.mjs --all-pages '<591 list url>'` crawls page 1 onward for the same search and stops when a page has no items or no new item URLs.
- `node scripts/scrape-591-taxonomy.mjs '<591 list url>'` fetches the live results page plus its current JS bundle and builds a JSON lookup for values such as `region=22`, `kind=2`, `section=341`, and `circle=22295`.
- [`data/591-taxonomy.generated.json`](./data/591-taxonomy.generated.json) is the local store for the full code list. Refresh it whenever you want to sync against the current live site.
- `node scripts/resolve-591-url.mjs --list sections --region 台東縣` lists stored codes without touching the network.
- `node scripts/resolve-591-url.mjs --region 台東縣 --kind 獨立套房 --section 台東市 --page 2` resolves names or aliases to IDs and prints the final 591 URL.
- `node scripts/quick-591-url.mjs taitung studio taitungcity 2` is the short positional wrapper for the same workflow.
- On Windows, `npm run ...` may need escaping because `&` in the query string can be split by the shell.
- Existing photo links and local downloads are preserved in [`data/enrichment.json`](./data/enrichment.json) when you rebuild.
- You can paste multiple full `Ctrl+A` results pages into the same raw `.txt`. The parser scans each `已為你找到...` block and ignores repeated page chrome between them.
- If the same property appears multiple times across pasted pages or across different dated raw files, it is kept as a single property in the viewer. The newest snapshot wins.
- The hosted import button keeps imports in the current browser only.
- `npm run build` now also generates a minimal [`public`](./public) directory for Vercel deployments.

## Hosted On Vercel

The repo can now run in two modes:

- Local mode: the viewer reads from the checked-in generated files, and imports/details are stored in the current browser only.
- Vercel mode: the viewer still boots from the checked-in generated files, and imports/details are also stored in the current browser only.

### What is already implemented

- [`index.html`](./index.html) is the deployment entry point for the static UI.
- [`vercel.json`](./vercel.json) pins the Vercel build to `npm run build` with `public` as the output directory.
- [`api/data.js`](./api/data.js) returns the current app data.
- [`api/import-591.js`](./api/import-591.js) imports listings from a live 591 results URL.
- Live imports and lazy detail enrichment are browser-local and stored in `window.localStorage`.
- [`web/app.js`](./web/app.js) loads `/api/data` on startup and exposes an `Import 591` panel in the header.
- [`.vercelignore`](./.vercelignore) keeps local-only files out of hosted deployments.

### Manual Vercel setup

I do not have a live Vercel account connector in this session, so I cannot create or link the project from your account directly. You can create it manually in the Vercel dashboard.

1. Open your projects page:
   `https://vercel.com/bmavmartinez-8475s-projects`
2. Create a new project and import this folder or its Git repo.
3. Use these settings:
   - Framework Preset: `Other`
   - Root Directory: the repo root
   - Install Command: leave default `npm install`
   - Build Command: leave the detected `npm run build`
   - Output Directory: leave empty in the dashboard, because [`vercel.json`](./vercel.json) now sets it to `public`
4. Deploy.

### First deploy checklist

Before the first deploy, make sure the checked-in data is current:

```powershell
npm run build
```

That refreshes the static seed files:

- [`data/listings.generated.json`](./data/listings.generated.json)
- [`web/app-data.js`](./web/app-data.js)
- [`public/index.html`](./public/index.html)
- [`public/web/app-data.js`](./public/web/app-data.js)

After deployment:

- the page should load from the static seed immediately
- `/api/data` should report `local-build` as the source
- the `Import 591` button should work without any extra storage setup

### Hosted import behavior

The in-app import panel accepts a live 591 list URL such as:

```text
https://rent.591.com.tw/list?region=22&kind=2&section=341&page=1
```

Options:

- `All pages`: crawl page 1 onward for the same search until no new items appear
- `Fetch photos`: additionally visit each item page and replace preview images with the full gallery

Recommended hosted workflow:

1. Import from the search URL you want in the current browser.
2. Confirm the new cards appear and persist after a refresh.
3. Only enable `Fetch photos` when you want the slower full item-page pass.

### Local vs hosted persistence

- Local `npm run start`: imports and lazy detail enrichment are written to browser `localStorage`.
- Vercel: imports and lazy detail enrichment are also written to browser `localStorage`.
- Re-running `npm run build` regenerates the static seed, but each browser keeps its own imported overlay until that browser storage is cleared.

## Taxonomy Helper

The file [`data/591-taxonomy.generated.json`](./data/591-taxonomy.generated.json) stores the live code list scraped from 591.

Refresh it when needed:

```powershell
npm run scrape-taxonomy -- 'https://rent.591.com.tw/list?region=22&kind=2&section=341&page=2'
```

After that, all helper commands work locally from the stored JSON.

### Detailed helper

Use [`scripts/resolve-591-url.mjs`](./scripts/resolve-591-url.mjs) when you want explicit flags or when you need list/search mode.

Examples:

```powershell
npm run query-591 -- --list regions
npm run query-591 -- --list kinds
npm run query-591 -- --list sections --region 台東縣
npm run query-591 -- --list circles --region 台東縣 --query 知本
npm run query-591 -- --region 台東縣 --kind 獨立套房 --section 台東市 --page 2
npm run query-591 -- --region 22 --kind 2 --section 341 --page 2
```

Accepted inputs:

- Chinese names: `台東縣`, `臺東市`, `知本溫泉商圈`
- English aliases: `taitung`, `taitungcity`, `studio`, `parking`, `zhiben`
- Numeric ids: `22`, `341`, `22295`

Common kind aliases:

- `apartment` -> `整層住家`
- `studio` -> `獨立套房`
- `room` -> `雅房`
- `parking` -> `車位`

County / city shorthand:

- `taitungcounty` or `ttcounty` -> `台東縣`
- `taitungcity` or `ttcity` -> `臺東市`

If a name is ambiguous, the helper prints the matching candidates instead of guessing.

### Quick wrapper

Use [`scripts/quick-591-url.mjs`](./scripts/quick-591-url.mjs) when you just want the URL quickly.

Positional order:

1. region
2. kind
3. section
4. page

Examples:

```powershell
npm run quick-591 -- 台東縣 獨立套房 台東市 2
npm run quick-591 -- taitung studio taitungcity 2
npm run quick-591 -- taitung studio taitung 2
npm run quick-591 -- taitung parking --circle zhiben
```

Notes:

- The quick wrapper forwards to the detailed helper internally.
- `taitung` works as the region alias for `台東縣`.
- Within the 台東 region, `taitung` also works as a section alias for `臺東市`, so `taitung studio taitung 2` is valid.
- Use the detailed helper if you need list mode, query filtering, or more explicit control.
