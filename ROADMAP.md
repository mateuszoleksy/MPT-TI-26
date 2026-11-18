# Roadmapa projektu — MPT-TI-26

- **Stan na:** 2026-11-18
- **Baza:** `main` (`62576ff`); MPT26-40 uwzględnione na podstawie gotowego PR-a oczekującego na merge
- **Plan pierwotny:** [docs/implementation-plan.md](docs/implementation-plan.md)
- **Architektura:** [docs/architecture.md](docs/architecture.md)
- **Uruchomienie i integracja:** [docs/integration.md](docs/integration.md)

## Podsumowanie

Podstawowy przepływ MVP jest zaimplementowany: scraper Blix pobiera kandydatów
promocji dla Biedronki i Lidla, zapisuje je w PostgreSQL, API udostępnia dane,
a frontend pozwala je wyszukiwać i filtrować. MPT26-45 jest scalone z `main`
(PR #44). Automatyzacja z MPT26-40 jest ukończona w oczekującym PR-ze i jest
uwzględniona jako gotowa funkcjonalność MVP.

Legenda: **Gotowe** — funkcjonalność działa w kodzie lub w gotowym PR-ze;
**Do zrobienia** — pozostaje rzeczywista luka albo ograniczenie.

## Gotowe w MVP

| Obszar                             | Status i zakres                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo i jakość                  | **Gotowe.** npm workspaces, TypeScript w trybie strict, Oxlint, Prettier, testy i buildy są skonfigurowane. CI uruchamia format check, lint, typecheck, testy oraz buildy aplikacji i obrazów Docker.                                                                                                                           |
| Wspólne modele                     | **Gotowe.** `packages/shared/src/index.ts` udostępnia schematy Zod dla ofert, kandydatów źródłowych i filtrów API.                                                                                                                                                                                                              |
| PostgreSQL i migracje              | **Gotowe.** Docker Compose używa PostgreSQL 17. Drizzle, pula `pg`, migracja `packages/shared/migrations/0000_candidates.sql` oraz zapis/odczyt w `packages/shared/src/db/index.ts` obsługują tabele kandydatów i przebiegów scrapera.                                                                                          |
| Import Blix                        | **Gotowe.** `apps/scraper/src/adapters/blix-parser.ts` odkrywa gazetki, parsuje kandydatów i odrzuca nieprawidłowe rekordy. Lokalne fixtures pokrywają parser bez zależności od sieci.                                                                                                                                          |
| Automatyzacja scrapera (MPT26-40)  | **Gotowe w PR-ze oczekującym na merge.** Worker cyklicznie pobiera aktywne gazetki obu sklepów z Blix; domyślnie codziennie o 06:00 w `Europe/Warsaw`. Waliduje kandydatów przez `SourceOfferSchema`, zapisuje je przez `saveSourceOffers`, izoluje błędy sklepów/źródeł, ma timeout HTTP 15 s, logi postępu i tryb `--once`.   |
| API                                | **Gotowe.** Fastify waliduje parametry, odpytuje PostgreSQL i zwraca wyniki wraz z paginacją. Wyszukiwanie nazw używa niewrażliwego na wielkość liter `ILIKE`; dostępne są filtry sklepu, kategorii, ceny, daty i wymogu aplikacji.                                                                                             |
| Frontend i wyszukiwarka (MPT26-45) | **Gotowe i scalone.** React udostępnia wyszukiwarkę, filtry, sortowanie, karty ofert i synchronizację stanu z URL. Input pozostaje zamontowany podczas pobierania, zachowuje focus, a zapytania i URL aktualizują się po 300 ms. Brzegowe spacje są przycinane, a frazy z samych spacji pomijane w UI i wspólnym schemacie Zod. |
| Kontenery i uruchomienie           | **Gotowe.** Compose definiuje bazę, migracje, API, scraper i frontend; CI buduje obrazy Docker. Lokalne polecenia uruchomienia są opisane w `docs/integration.md`.                                                                                                                                                              |

## Pozostałe prace

1. **Jakość i weryfikacja danych.** Blix dostarcza kandydatów oznaczonych jako
   wymagające weryfikacji; ceny i warunki nie są niezależnie potwierdzane.
   Potrzebny jest proces zatwierdzania danych oraz — jeśli ma wejść do zakresu —
   OCR i dodatkowa ekstrakcja warunków.
2. **Bezpośrednie adaptery sklepów.** `biedronka.ts` i `lidl.ts` nadal są
   placeholderami. Aktualny import działa przez Blix; bezpośrednie źródła
   sklepowe nie są zaimplementowane.
3. **Deduplikacja między źródłami.** Parser rozpoznaje powtórzone wystąpienia,
   a baza potrafi grupować rekordy z kluczem duplikatu. Automatyczne wyliczanie
   stabilnego klucza i scalanie równoważnych ofert z różnych gazetek/źródeł
   pozostaje do domknięcia.
4. **Pełna obsługa sortowania i rabatów.** Kontrakt API przewiduje m.in.
   `minDiscount`, sortowanie po rabacie i cenie jednostkowej, ale zapytanie DB
   nie implementuje jeszcze tych wariantów w pełni. Należy albo je wdrożyć,
   albo zawęzić kontrakt i UI do obsługiwanych opcji.
5. **Test przepływu end-to-end.** Testy jednostkowe i testy bazy pokrywają
   poszczególne warstwy; brakuje automatycznego testu pełnego przepływu
   fixture → scraper → PostgreSQL → API.

Funkcje kont użytkowników, ulubionych i zapisanych wyszukiwań pozostają poza
zakresem podstawowego MVP.
