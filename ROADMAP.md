# Roadmapa MVP — weryfikacja względem implementacji

- **Stan na:** 2026-11-13
- **Porównana baza:** `main` (`124d152`, merge PR #21)
- **Dokument źródłowy:** [docs/implementation-plan.md](docs/implementation-plan.md)

## Podsumowanie

Repozytorium zawiera działające szkielety monorepo, kontrakty współdzielone,
API zwracające dane przykładowe, prosty frontend oraz eksperymentalny scraper
gazetek Blix. Nie jest to jeszcze kompletne MVP: aplikacja nie zapisuje ani nie
odczytuje ofert z bazy, standardowe adaptery sklepów nie pobierają danych, a
interfejs nie udostępnia filtrów zapowiedzianych w planie.

Legenda:

- **Zrobione** — wymaganie jest obecne w kodzie.
- **Częściowo** — istnieje część funkcjonalności lub eksperyment, ale nie
  realizuje całego wymagania.
- **Brak** — wymagania nie ma w bieżącym kodzie.

## Porównanie planu z kodem

| Obszar                        | Założenie planu                                                                         | Stan na `main` i dowody                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo i TypeScript         | npm workspaces: `api`, `scraper`, `web`, `shared`; strict TypeScript i Prettier         | **Zrobione.** Struktura workspace'ów i skrypty `build`, `typecheck`, `test`, `format` są skonfigurowane. Bazowe `tsconfig` ma `strict: true`.                                                                                                                                                                                             |
| Wspólny model ofert           | Zod `OfferSchema`, filtry i helper rabatu                                               | **Częściowo.** `OfferSchema`, `OfferFiltersSchema` i `discountPercent()` są w `packages/shared/src/index.ts`; testy walidują część kontraktu. Planowany `pricePerUnit()` nie istnieje.                                                                                                                                                    |
| PostgreSQL i ORM              | Drizzle, schemat `offers`, `categories`, `scrape_runs`, migracje i klient puli połączeń | **Brak.** `docker-compose.yml` uruchamia PostgreSQL, ale nie ma zależności Drizzle/`pg`, schematu, migracji ani kodu dostępu do bazy. Zmienne `DATABASE_URL` są przekazywane kontenerom, lecz aplikacje ich nie używają.                                                                                                                  |
| Adaptery sklepów              | Scraping Biedronki i Lidla, parsowanie, normalizacja i walidacja ofert                  | **Częściowo.** `apps/scraper/src/adapters/biedronka.ts` i `lidl.ts` nadal zwracają puste tablice. Niezależnie istnieje parser Blix, który pobiera gazetki obu sieci i tworzy kandydatów wymagających ręcznej weryfikacji.                                                                                                                 |
| Scraper i trwałość danych     | Harmonogram, zapis ofert przez UPSERT i historia `scrape_runs`                          | **Częściowo / brak zapisu.** `apps/scraper/src/index.ts` ma harmonogram `node-cron` i tryb `--once`, ale wykonuje tylko adaptery sklepów, loguje wynik i zawiera TODO dotyczące UPSERT. CLI Blix (`offers:blix`) działa osobno i pokazuje kandydatów; dokumentacja `docs/blix.md` potwierdza brak integracji z harmonogramem, bazą i API. |
| Fixtures i testy scrapera     | Zapisane przykłady stron sklepów i testy parserów                                       | **Częściowo.** Są fixture i testy parsera Blix w `apps/scraper/src/adapters/__fixtures__/blix-sample.json` oraz `apps/scraper/src/blix-parser.test.ts`. Nie ma fixture'ów ani implementacji parserów bezpośrednio dla Biedronki i Lidla.                                                                                                  |
| REST API                      | Filtrowanie SQL, wyszukiwanie, sortowanie i paginacja `/api/offers`                     | **Częściowo.** API waliduje query przez `OfferFiltersSchema`, ale `apps/api/src/index.ts` zwraca statyczną ofertę `sample`. Nie ma zapytań SQL ani faktycznego filtrowania, sortowania czy paginacji.                                                                                                                                     |
| Frontend                      | Tailwind, wyszukiwarka, filtry, karty/siatka ofert i stan filtrów w URL                 | **Brak / bardzo podstawowy szkielet.** `apps/web/src/App.tsx` pobiera `/api/offers` bez parametrów i wyświetla prostą listę. Nie ma Tailwind, komponentów filtrów/kart/siatki ani synchronizacji z URL.                                                                                                                                   |
| Docker i uruchamianie całości | `docker compose up --build` oraz pełny przepływ scraper → baza → API → UI               | **Częściowo.** Compose definiuje `db`, `api`, `scraper` i `web`; CI buduje obrazy Docker. Nie ma jednak migracji ani integracji z bazą, scraper produkcyjny nie dostarcza ofert, a API zwraca mock. Samo uruchomienie kontenerów nie potwierdza przepływu E2E.                                                                            |
| CI                            | Kontrole jakości i budowanie obrazów na PR                                              | **Częściowo.** Workflow na porównanej gałęzi wykonuje Prettier check, typecheck, testy, build i buildy Docker. Nie ma w nim lintera; dodanie lintera jest osobną, niezmergowaną pracą na branchu `chore/dod-ci-workflow`.                                                                                                                 |

## Co już działa

1. Monorepo i ścisła konfiguracja TypeScript dla workspace'ów.
2. Wspólny kontrakt oferty oraz walidacja query API przez Zod.
3. API health check oraz endpoint ofert zwracający mock.
4. Prosty frontend React z pobieraniem ofert i wyliczeniem procentu rabatu.
5. Eksperymentalne pobieranie aktywnych gazetek Blix dla Biedronki i Lidla,
   parsowanie kandydatów, walidacja pól/daty oraz testy fixture'ów.
6. Konfiguracja Docker Compose i workflow CI budujący aplikacje oraz obrazy.

## Brakujące elementy MVP — proponowana kolejność

### 1. Uzgodnić źródło i model danych

- Rozstrzygnąć, czy MVP pobiera dane bezpośrednio ze stron sklepów, czy przez
  Blix. Obecny parser Blix jawnie oznacza ceny jako niezweryfikowane, a
  `requiresApp`, jednostki i warunki jako nieznane — nie powinien zasilać
  produkcyjnych ofert bez zatwierdzonej walidacji.
- Doprecyzować schemat tabel i relacje dla danych wymaganych przez UI i API.

### 2. Dodać trwałą warstwę danych

- Dodać ORM/sterownik, schemat bazy i migracje dla ofert oraz historii scrapów.
- Dodać konfigurację połączeń i bezpieczne zamykanie puli.
- Uruchamiać migracje w przewidywalnym miejscu podczas wdrożenia.

### 3. Zakończyć pobieranie ofert i integrację scrapera

- Implementować i testować źródła Biedronki/Lidla albo zatwierdzony import Blix.
- Normalizować oraz walidować ceny, jednostki, daty, warunki i wymóg aplikacji;
  jawnie odrzucać lub kwarantannować niepewne dane.
- Zapisywać oferty idempotentnym UPSERT-em i rejestrować wynik każdego
  uruchomienia w `scrape_runs`.
- Sprawdzić politykę dostępu do źródeł, `robots.txt` i limity pobierania.

### 4. Zastąpić mock w API

- Odczytywać oferty z PostgreSQL.
- Implementować wyszukiwanie tekstowe, filtry sklepu/kategorii/ceny/rabatu/
  aktywności/wymogu aplikacji, sortowanie i paginację.
- Dodać testy endpointu dla wyników, filtrów, błędnych parametrów i pustej bazy.

### 5. Zbudować użyteczny interfejs

- Dodać wyszukiwanie, wybór sklepu/kategorii, limit ceny oraz filtr ofert
  wymagających aplikacji.
- Prezentować zweryfikowaną cenę, rabat, jednostkę, warunki i datę
  obowiązywania w kartach i responsywnej siatce.
- Synchronizować filtry z URL, aby można było udostępniać wyniki.
- Dodać stany ładowania, błędu i braku wyników.

### 6. Zweryfikować pełny przepływ i kryteria odbioru

- Dodać test integracyjny/E2E potwierdzający scraper → baza → API → frontend
  na kontrolowanych danych.
- Potwierdzić działanie czystego `docker compose up --build`, w tym inicjalizację
  schematu i dostępność API.
- Uzupełnić CI o lint; sprawdzić, czy wymagane kontrole są wymaganymi status
  checks przed scaleniem PR.

## Kryterium ukończenia MVP

MVP można uznać za gotowe, gdy po czystym uruchomieniu środowiska baza jest
zainicjalizowana, scraper zapisuje zwalidowane oferty obu obsługiwanych sieci,
API zwraca je z działającymi filtrami i sortowaniem, a frontend pozwala je
wyszukać oraz udostępniać wynik przez URL. Cały przepływ powinien być objęty
powtarzalną weryfikacją automatyczną, bez zależności od bieżącej zawartości stron
zewnętrznych w testach.
