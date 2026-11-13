CREATE TABLE offer_candidates (
  id text PRIMARY KEY, store text NOT NULL CHECK (store IN ('lidl', 'biedronka')),
  leaflet_id text NOT NULL, name text NOT NULL, category text,
  reported_price double precision NOT NULL CHECK (reported_price > 0),
  valid_from date NOT NULL, valid_to date NOT NULL CHECK (valid_to >= valid_from),
  payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX offer_candidates_store_dates ON offer_candidates(store, valid_from, valid_to);
--> statement-breakpoint
CREATE TABLE scrape_runs (
  id serial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL, saved integer NOT NULL, details jsonb NOT NULL
);
