# Tides - Agent Notes

## What this project is

Tides is a personal tool for tracking Canadian tide predictions.
The working UI name is "Captain Crunch's Tide Tracker" (see commit `aa02bbe`).
The core idea, present since the very first commit, is finding low-tide windows at a given station, e.g. "the next N times the tide drops below X meters."

The repo contains two separate implementations of that idea, not one project superseding the other in place:

- `ConsoleCLI/` is the original prototype (commits `f8fb470`, `2421e33`).
It has not been touched since the web app was added in `00c3a24`, so treat it as legacy/frozen rather than actively maintained.
- `WebApp/` is the actively developed version, based on commit history from `00c3a24` onward through the most recent commits (mobile chart fixes, map toggle, lowest-tides table, DST fix, etc.).

The two do not share code, data source, or data format.
`ConsoleCLI` reads a static bulk-exported CSV for a single hardcoded station (Vancouver, 7735).
`WebApp` calls the live Fisheries and Oceans Canada IWLS (Integrated Water Level System) API and supports searching any station.

## Stack and layout

**`ConsoleCLI/Tides.py`**
Standalone Python 3 script, stdlib only (`csv`, `datetime`, `enum`, `webbrowser`), no `requirements.txt` and no dependency manager.
Reads `ConsoleCLI/data/07735_data.csv` (a manually downloaded export from tides.gc.ca) and prints the next N lowest tides under a given height to stdout.
There is no CLI argument parsing; parameters are set by editing the `FindTide(...)` call at the bottom of the file directly.

**`WebApp/Tides.Api/`**
ASP.NET Core 9 minimal-hosting API (`Program.cs`), single project, no separate class library.
- `Controllers/StationsController.cs` - station search (`GET /api/stations?search=`).
- `Controllers/TidePredictionsController.cs` - predictions (`GET /api/tides/{code}`) and derived low-tide analysis (`GET /api/tides/{code}/analysis`).
- `Services/IwlsApiService.cs` - proxies and caches (`IMemoryCache`, 24h for station data, 6h for tide predictions) calls to the external IWLS API. Self-throttles to roughly one request per 350ms via a static `SemaphoreSlim`, since it's a shared upstream rate limit. Chunks date ranges into 30-day windows because the upstream API caps request span.
- `Services/TideAnalysisService.cs` - computes the overall lowest tide and per-day lowest tides for a range, bucketed into Morning/Afternoon/Evening/Night by local hour (station-specific timezone, not server timezone).
- The API also serves the built SPA as static files (`UseStaticFiles` + `MapFallbackToFile`), so the intent is a single deployable unit (see commit `757f7de`, "Add static file serving and deploy to Azure App Service"). There is no deployment workflow or publish profile checked into the repo, so the actual deploy mechanics live outside it.

**`WebApp/tides-client/`**
Vite + React 19 + TypeScript SPA, styled with Tailwind CSS v4 (via `@tailwindcss/vite`, no separate `tailwind.config`).
- Data fetching/caching via TanStack Query, plus a hand-rolled localStorage layer on top (`src/api/tideCache.ts`) to avoid redundant fetches across sessions (commit `bbf67f4`).
- Charting via Chart.js + `react-chartjs-2`, with `chartjs-plugin-zoom` for pinch/touch panning, tuned specifically for mobile viewports (several fixes: `d97a7bc`, `594e6aa`, `c73f9f7`).
- Station picker map via Leaflet/`react-leaflet`, OpenStreetMap tiles (switched from Stadia Maps in `cd6e355`), hidden behind a toggle by default (`cb18803`) rather than always shown.
- Dev server (`vite.config.ts`) proxies `/api` to `http://localhost:5062`, which is the API's local Kestrel port from `Properties/launchSettings.json`. Run the API and the client dev server side by side for local development; the client does not stand alone against a mock backend.

## How to run locally

The API and the client are two separate processes; run both side by side.
There is no root-level script that starts everything at once.

**API** (`WebApp/Tides.Api/`)
```
cd WebApp/Tides.Api
dotnet run
```
Listens on `http://localhost:5062` (from `Properties/launchSettings.json`).
Runs with `ASPNETCORE_ENVIRONMENT=Development`, which is what turns on CORS for `http://localhost:5173` via `appsettings.Development.json`; without that setting `AllowedOrigins` is empty and CORS middleware is skipped entirely (see `Program.cs`).
No local secrets or connection string are needed, since the only external dependency is the public IWLS API.

**Client** (`WebApp/tides-client/`)
```
cd WebApp/tides-client
npm install
npm run dev
```
Vite dev server on `http://localhost:5173`.
`/api` requests are proxied to `http://localhost:5062` (see `vite.config.ts`), so the API must already be running for the client to show data.

**Console CLI** (`ConsoleCLI/`)
```
cd ConsoleCLI
python3 Tides.py
```
No dependency installation is actually required (stdlib only), despite the venv steps in `ConsoleCLI/Readme.md`.
Must be run from inside `ConsoleCLI/` since it opens `data/07735_data.csv` with a relative path.
Parameters (`numberOfOccurences`, `maxHeight`, `location`, `dateString`) are set by editing the `FindTide(...)` call at the bottom of `Tides.py`, there's no CLI argument parsing.

## How to deploy to the cloud

Only `WebApp/` is deployed; `ConsoleCLI/` is a local-only script with no deployment story.

The app is designed to ship as a single deployable unit: the API serves the client's built assets as static files (`UseDefaultFiles` + `UseStaticFiles` + `MapFallbackToFile` in `Program.cs`), reading from `Tides.Api/wwwroot/`, which is gitignored as a build artifact.
This was set up in commit `757f7de` ("Add static file serving and deploy to Azure App Service") together with making CORS conditional, since a same-origin deployment doesn't need CORS at all (production `appsettings.json` has no `AllowedOrigins`, so CORS middleware never registers in that environment).

There is no CI/CD pipeline, publish profile, or infrastructure-as-code checked into this repo, so deployment today is a manual process.
The general shape, based on what `Program.cs` expects:

1. Build the client: `cd WebApp/tides-client && npm run build` (outputs to `dist/`).
2. Copy the contents of `tides-client/dist/` into `WebApp/Tides.Api/wwwroot/`.
3. Publish the API: `cd WebApp/Tides.Api && dotnet publish -c Release`.
4. Deploy the publish output to an Azure App Service (e.g. `az webapp up`, zip deploy, or the Visual Studio / VS Code Azure publish flow).

I don't have the actual App Service name, resource group, or region this deploys to, it isn't recorded anywhere in the repo or in the root `CLAUDE.md` Azure section, and my Azure CLI session had expired when I checked.
**Q: what's the target App Service (name + resource group), and is there a script or documented process you already use for steps 1-4, or has this always been done by hand?**
Once I know that, I can replace the generic steps above with the exact commands and record them here.

## Testing

There are currently no automated tests anywhere in this repo: no test project in `WebApp/Tides.sln`, no test script or framework in `tides-client/package.json`, no tests for the Python CLI.

What exists today as a proxy for correctness:
- `tides-client`: `npm run lint` (ESLint) and `npm run build` (`tsc -b && vite build`, which surfaces type errors but doesn't verify behavior).
- `Tides.Api`: `dotnet build` from `WebApp/` only confirms it compiles; nothing exercises the controllers or services.
- `ConsoleCLI/Tides.py`: no automated check at all. Verification is running the script and reading its stdout.

If asked to change behavior in `TideAnalysisService` (timezone/day-bucketing math) or `IwlsApiService` (rate limiting, chunking, caching), be aware there is no regression safety net today; manual verification against the running app is the only option unless tests are added first.
