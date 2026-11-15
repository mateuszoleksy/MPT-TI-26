# Blix scraper

Run from the repository root after [database setup](integration.md):

```sh
npm run offers:blix -- --store lidl --list            # list leaflets and dates
npm run offers:blix -- --store lidl --persist         # import active Lidl leaflets
npm run offers:blix -- --store biedronka --persist    # import active Biedronka leaflets
```

Imports update existing occurrences. `--json` prints all records; the table shows only 20.
Failed leaflets produce a nonzero exit code while successful results are kept. Missing conditions remain unknown.

```sh
npm run dev:scraper                     # schedule in SCRAPE_TZ (default Europe/Warsaw)
npm run scrape:once -w @promo/scraper    # fetch once without saving; nonzero on partial failure
```

The scheduled worker currently logs results only. Use `offers:blix --persist` to save data; scheduled database writes remain to be connected.
Compose restarts the worker unless stopped and allows 2 minutes to finish an active run. `SCRAPE_CRON` defaults to `0 6 * * *`.
Tests: `npm run test -w @promo/scraper`.
