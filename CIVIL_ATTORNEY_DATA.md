# Civil Attorney Data — Run Before Launch

The civil attorney scraper is wired and ready. Run this once before launch
to populate family law, immigration, employment, PI, and civil rights
attorneys across all 97 cities.

## Command

```bash
cd backend
GOOGLE_PLACES_KEY=your_key node src/scripts/scrape_providers_national.js --type civil
```

Requires `GOOGLE_PLACES_KEY` in `.env`. Takes ~20–40 minutes for all 97 cities.

## What it ingests

| Practice area | Google Places query |
|---|---|
| Personal Injury | `personal injury attorney {city} {state}` |
| Family Law | `family law attorney {city} {state}` |
| Immigration | `immigration attorney {city} {state}` |
| Employment | `employment attorney {city} {state}` |
| Bankruptcy | `bankruptcy attorney {city} {state}` |
| Civil Rights | `civil rights attorney {city} {state}` |

## After running

The nightly scheduler (Step 1b, Sundays) will keep the civil attorney
database fresh automatically. The first run populates it; the weekly
refresh keeps it current.

## Why this matters

Without this data:
- Users who pick "I Was Injured" get zero search results
- Users who pick "Immigration/ICE" get zero attorneys
- Users who pick "Eviction/Housing" get zero attorneys
- $748,500/month in non-criminal legal revenue is $0

With this data: all six civil category flows work end-to-end.
