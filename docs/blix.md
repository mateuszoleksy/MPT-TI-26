# Blix scraper

Fetches active Lidl and Biedronka leaflets automatically, using dates in Warsaw.

```sh
npm run build -w @promo/shared
npm run offers:blix -- --store lidl
npm run offers:blix -- --store biedronka
```

Use `--list` for leaflet titles and dates, or `--json` for all records. The table shows 20 products.

Prices and conditions remain unverified; `requiresApp: null` means unknown. Failed leaflets are reported separately, with exit code 1 even if other leaflets succeeded.

`offers:blix` runs once per command. The scraper worker also scrapes both stores on a schedule:

```sh
npm run dev:scraper                        # scheduler, SCRAPE_CRON (default 0 6 * * *) in SCRAPE_TZ (default Europe/Warsaw)
npm run scrape:once -w @promo/scraper      # single run, exit code 1 on any failure
SCRAPE_CRON='*/5 * * * *' npm run dev:scraper   # quick local check
```

In docker compose the `scraper` service runs the scheduler and reads both variables from `.env`. Overlapping runs are skipped. Database writes and API integration are not connected yet.

Tests: `npm run test -w @promo/scraper`.
