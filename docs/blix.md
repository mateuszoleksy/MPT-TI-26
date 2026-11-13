# Blix scraper

Run from the repository root after database setup:

```sh
npm run offers:blix -- --store lidl --list            # list leaflets and dates
npm run offers:blix -- --store lidl --persist         # import active Lidl leaflets
npm run offers:blix -- --store biedronka --persist    # import active Biedronka leaflets
```

Imports update existing occurrences. `--json` prints all records; the table shows only 20.
Failed leaflets produce a nonzero exit code while successful results are kept. Missing conditions remain unknown.
