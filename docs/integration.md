# Database integration

Use Node 24 (`nvm use` in WSL) and start Docker. Run from the repository root:

```sh
test -f .env || cp .env.example .env
npm ci
npm run build -w @promo/shared
docker compose up -d db
npm run db:migrate
```

If PostgreSQL is still starting, wait and retry the migration. The default `.env` connection is:

```dotenv
DATABASE_URL=postgres://promo:promo@localhost:5432/promo
```

Format: `user:password@host:port/database`. Adjust it for your database. If port 5432 is occupied, use the existing PostgreSQL instance with a matching `DATABASE_URL` or publish the Compose database on another local port. Compose uses host `db` inside its network.

Import offers using [blix.md](blix.md). Start the API and page in separate terminals:

```sh
npm run dev:api    # http://localhost:3000
npm run dev:web    # open the Vite URL, usually http://localhost:5173
```

Check `curl http://localhost:3000/api/health`, then find an imported product on the page. The importer and API must use the same database. A fresh database is empty. Local data is not included in Git.

For Docker, run `docker compose up -d --build`. Migrations run automatically and the page uses port 8080. Use the commands in [blix.md](blix.md) to run OCR manually or enable scheduled OCR.
