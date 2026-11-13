# MPT-TI-26

A repository for creating a project as part of the Metodyki Projektów Teleinformatycznych course at AGH UST.

A web app that collects current promotions from **Biedronka** and **Lidl** in one place
and lets students filter them by what actually matters on a student budget: price,
price per kg/l, discount, category, and whether the deal needs a loyalty app.

## Why / who is it for

A student wants a quick answer to "what's the cheapest pasta / coffee / protein this week, and where?"

## Current state: live demo

The first clickable version runs on **hard-coded sample data** — there is no
scraper or database behind it yet.

| File                    | What it contains                                                               |
| ----------------------- | ------------------------------------------------------------------------------ |
| `apps/api/src/index.ts` | Fastify API; `GET /api/offers` returns 12 sample offers (Lidl + Biedronka)     |
| `apps/web/src/App.tsx`  | The whole UI on one screen: offer grid, search, store, max price, no-app, sort |
| `packages/shared`       | The `Offer` type and filter schema used by both of the above                   |

Sample names and promo prices come from Blix.pl leaflets (7.11.2026); regular
prices, units and conditions were added by hand. Offer dates are fixed
(5–11.11 and 12–18.11.2026). Filtering and sorting happen in the browser.

Run it (two terminals):

```bash
npm install
npm run build -w @promo/shared
npm run dev:api        # http://localhost:3000/api/offers
npm run dev:web        # http://localhost:5173
```

Usage scenarios 1–4 can be shown in the demo; 5 only as an "od 12.11" label on
the card; 6 (filters in the URL) is not implemented yet.

## Tech stack (planned)

Everything is TypeScript/Python in one npm workspaces monorepo, so the offer
type and filter schema are defined once (`packages/shared`) and used by the
scraper, API and frontend.

| Layer      | Choice                                       | Why                                                                 |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Language   | TypeScript                                   | One language for the whole team; types catch scraper/API mismatches |
| Frontend   | React + Vite                                 | Fast dev server, huge ecosystem, easy to find help                  |
| API        | Fastify                                      | Fast, TS-friendly, schema validation                                |
| Database   | PostgreSQL                                   | Filtering/sorting/full-text search are SQL's strengths              |
| Scraping   | fetch + Cheerio; Playwright when needed      | Cheerio for static HTML; Playwright only for JS-rendered pages      |
| Scheduling | node-cron                                    | Simple; upgrade to BullMQ + Redis only if needed                    |
| Containers | Docker + docker compose                      | Whole stack starts with one command on any laptop                   |
| CI/CD      | GitHub Actions + GHCR, Renovate              | Checks on every PR, images on tag, automated dependency updates     |
| Tests      | Vitest; scraper tests on saved HTML fixtures | Scraper tests don't hit live sites                                  |

## Repository layout

```
.
├── apps/
│   ├── web/        React + Vite frontend (nginx in Docker)
│   ├── api/        Fastify REST API
│   └── scraper/    Scheduled worker; one adapter per store in src/adapters/
├── packages/
│   └── shared/     types (Offer, OfferFilters)
├── docs/           Architecture & design notes
├── docker-compose.yml
└── tsconfig.base.json
```

## Getting started

Requirements: Node ≥ 22 (24 recommended, see `.nvmrc`), Docker.

```bash
cp .env.example .env
npm install

# Option A — everything in Docker
docker compose up --build
#   web: http://localhost:8080   api: http://localhost:3000/api/health

# Option B — local dev with hot reload (DB in Docker), one terminal each
docker compose up -d db
npm run build -w @promo/shared
npm run dev:api        # api :3000
npm run dev:web        # web :5173
npm run dev:scraper    # scraper on cron
npm run scrape:once -w @promo/scraper   # run scrapers immediately
```

`npm run dev` runs the workspaces one after another, so it stops at the API
(a long-running process) and never starts the web app — use the separate
`dev:*` scripts above.

Other scripts: `npm test`, `npm run build`, `npm run typecheck`, `npm run format`.

## CI/CD

```mermaid
flowchart LR
    pr[PR / push to main] --> check[ci.yml<br/>format · typecheck · test · build]
    check --> dbuild[Docker build<br/>api · web · scraper<br/>no push]
    tag[git tag v*.*.*] --> release[release.yml]
    release --> ghcr[(ghcr.io<br/>…/mpt-ti-26-api, -web, -scraper)]
    renovate[Renovate<br/>Mondays before 6:00] -->|grouped PRs| pr
```

| Workflow                        | Trigger              | What it does                                                         |
| ------------------------------- | -------------------- | -------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | every PR, `main`     | `npm ci`, Prettier check, typecheck, `npm test`, build, Docker build |
| `.github/workflows/release.yml` | tag `v*.*.*`, manual | Builds and pushes all three images to GitHub Container Registry      |
| `renovate.json`                 | weekly               | Grouped PRs for npm deps, GitHub Actions and Docker base images      |

Releasing: `git tag v0.1.0 && git push origin v0.1.0`.

### Deployment environments

`release.yml` runs in a GitHub Environment, so each publish shows up under
the repo's Deployments and can be gated:

| Environment  | Used by                     |
| ------------ | --------------------------- |
| `production` | tag pushes `v*.*.*`         |
| `staging`    | manual run (`Run workflow`) |

[![Release Docker images](https://github.com/mateuszoleksy/MPT-TI-26/actions/workflows/release.yml/badge.svg)](https://github.com/mateuszoleksy/MPT-TI-26/actions/workflows/release.yml)

## Scraping etiquette & legal note

This is an educational project. The scraper must:

- check and respect each site's `robots.txt` and terms of use,
- run rarely
- store only offer data (name, price, dates, link) and always link back to the source.

Store websites change without notice.

## License

MIT — see [LICENSE](LICENSE).
