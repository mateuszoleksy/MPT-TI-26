# Blix scraper and OCR

Run commands from the repository root in Bash/WSL. Complete [database setup](integration.md) before using `--persist`. Batch imports cover leaflets currently listed as active.

## Local setup

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r apps/scraper/scripts/requirements-ocr.txt
```

Activate `.venv` in each OCR terminal, or set `PYTHON` to its Python executable.

## Import

Preview one leaflet without writing to PostgreSQL. Set `LEAFLET_ID` to the number in its Blix URL and adjust the store and product name:

```sh
npm run --silent offers:conditions -- --store biedronka --leaflet "$LEAFLET_ID" --match 'product name' --ocr --json
```

Small batch for both stores:

```sh
npm run offers:conditions -- --all --ocr --budget 8 --state "$HOME/.cache/promki/ocr.json" --persist
```

Full cycle, continuing from the same state:

```sh
time npm run offers:conditions -- --all --ocr --drain --budget 36 --max-hours 4 --state "$HOME/.cache/promki/ocr.json" --persist
```

`--all` discovers both stores. Add `--store lidl` or `--store biedronka` to select one. `--persist` saves to the database. Without `--drain`, the budget limits the run.

Progress is saved after each batch. Repeat the command to resume or refresh. New or changed offers are queued again. Do not run two workers on the same state file.

Duration depends on hardware, offer count, network and cache. `time` measures the run. Four hours is a processing limit, not an estimate. A running batch may finish after it.

`pending: 0` and `complete: true` mean processing finished without reported failures. They do not mean every field was recognized. Batch exit codes are **0** for no errors or pending work, **1** for source or OCR errors, and **2** for pending work. npm also labels code 2 as a failed command. Add `--json` for error details. To save the result:

```sh
npm run --silent offers:conditions -- --all --ocr --budget 8 --state "$HOME/.cache/promki/ocr.json" --persist --json > result.json
```

Reprocess saved text without downloads or OCR:

```sh
npm run offers:conditions -- --cached-only --state "$HOME/.cache/promki/ocr.json" --persist
```

Import without OCR: `npm run offers:blix -- --store lidl --persist` (or `biedronka`).

## Docker

Start the standard stack as described in [integration.md](integration.md), then:

```sh
docker compose --profile worker build ocr
docker compose --profile worker run --rm ocr
```

Python is included. Progress stays in `ocrdata`, separate from the local state file. The worker runs one cycle with a four-hour processing limit. Repeat to resume. A basic reimport preserves OCR details when the source record matches. Changes to the source price, dates or image link require a fresh OCR read.

## Scheduled OCR

```sh
docker compose -f docker-compose.yml -f docker-compose.ocr.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.ocr.yml logs -f scraper
```

This switches the existing scraper to OCR mode. It uses `SCRAPE_CRON` and `SCRAPE_TZ` (default 06:00 in Warsaw), waits for migrations, imports both stores and saves OCR progress in `ocrdata`. Each cycle saves basic offers before processing OCR batches. After four hours, the cycle finishes the current batch and stops. Skip the manual OCR container while a scheduled cycle is active. For daily runs, keep the scheduled worker running on the host that will execute the job.

OCR uses two compute threads by default. Set `OCR_THREADS=4` in the shell for a local run, or in `.env` before starting either Docker OCR mode, to use four threads.

For faster full-page OCR, set `OCR_PAGE_MAX_SIDE=1280` in the shell or Docker `.env`. This lowers the detector resolution only for whole pages and uses a separate page cache. Keep the default `0` for the original resolution. Compare both settings on your leaflets before enabling the limit for scheduled runs.

Set `OCR_REUSE_UNCHANGED=1` to refresh saved conditions when the page image hash and OCR configuration match. The earlier run must have completed the full-page read. The worker still checks image freshness using its HTTP cache. Legacy state needs one normal read before it can be reused.

If a required full-page read fails, the offer stays in the queue and keeps its last successful OCR result if the source offer is unchanged. The batch report's `ocrInferences` counts successful new reads of offer crops. Full-page reads are outside this count.

Both Docker OCR modes fetch the next page while OCR processes the current one. HTTP requests run one at a time, with a two-second delay before each request. Set `OCR_PREFETCH_PAGES=0` in `.env` to disable it, or `OCR_PREFETCH_PAGES=1` in the shell to enable it for a local run.

To test the same mode once on the local database, activate `.venv` and run:

```sh
npm run scrape:once -w @promo/scraper -- --ocr
```

## Checks and limits

```sh
npm test
python -m unittest discover -s apps/scraper/scripts
```

Missing or conflicting fields remain unknown. For priced bundles, OCR also checks the full page and attaches the condition when the reward name and price match the offer. Other conditions outside the product crop may be missed. Empty leaflets are reported while other sources continue.

Regular, previous and lowest-30-days prices stay separate. OCR reuses identical image crops. The same offer on several pages or leaflets is shown once when its product, package size, prices, dates and conditions agree. Grouped offers keep their source links.
