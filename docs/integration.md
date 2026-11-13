# Database integration

Run from the repository root with Node 24. Copy `.env.example` to `.env` and set `DATABASE_URL`.

```sh
npm ci                              # install dependencies
npm run build -w @promo/shared       # build shared models
docker compose up -d db             # start PostgreSQL
npm run db:migrate                  # create/update tables
npm run dev:api                     # start API on port 3000
```

Run `npm run dev:web` in another terminal; open the address printed by Vite.
If a database already uses port 5432, reuse it through `DATABASE_URL` instead of starting another.
Import commands are in [blix.md](blix.md). Unknown app requirements stay unknown; OCR and scheduling are separate changes.
