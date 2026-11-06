# Blix scraper

Fetches active Lidl and Biedronka leaflets automatically, using dates in Warsaw.

```sh
npm run build -w @promo/shared
npm run offers:blix -- --store lidl
npm run offers:blix -- --store biedronka
```

Use `--list` for leaflet titles and dates, or `--json` for all records. The table shows 20 products.

Prices and conditions remain unverified; `requiresApp: null` means unknown. Failed leaflets are reported separately, with exit code 1 even if other leaflets succeeded.

Runs once per command. Scheduling, database writes and API integration are not connected yet.

Tests: `npm run test -w @promo/scraper`.
