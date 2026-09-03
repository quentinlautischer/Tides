# Tides - Agent Notes

## What this project is

Tides is a personal tool for tracking tide predictions, originally Canada only and since extended to the US west coast.
The working UI name is "Captain Crunch's Tide Tracker" (see commit `aa02bbe`).
The core idea, present since the very first commit, is finding low-tide windows at a given station, e.g. "the next N times the tide drops below X meters."

Because that core idea is about an absolute threshold, the **vertical datum matters and differs by country**.
IWLS publishes heights above Chart Datum; NOAA publishes heights above MLLW.
The two zeros are not the same, so a "below 0.5m" threshold does not carry across the border, and US stations routinely show negative values where Canadian ones rarely do.
`Station.Datum` carries the label per station and the chart's y-axis title states it. Do not compare or blend heights across sources without accounting for this.

The repo contains two separate implementations of that idea, not one project superseding the other in place:

- `ConsoleCLI/` is the original prototype (commits `f8fb470`, `2421e33`).
It has not been touched since the web app was added in `00c3a24`, so treat it as legacy/frozen rather than actively maintained.
- `WebApp/` is the actively developed version, based on commit history from `00c3a24` onward through the most recent commits (mobile chart fixes, map toggle, lowest-tides table, DST fix, etc.).

The two do not share code, data source, or data format.
`ConsoleCLI` reads a static bulk-exported CSV for a single hardcoded station (Vancouver, 7735).
`WebApp` calls two live upstream APIs and supports searching any station they cover:
Fisheries and Oceans Canada IWLS (Integrated Water Level System) for Canada, and NOAA CO-OPS for the US west coast (WA, OR, CA).

## Stack and layout

**`ConsoleCLI/Tides.py`**
Standalone Python 3 script, stdlib only (`csv`, `datetime`, `enum`, `webbrowser`), no `requirements.txt` and no dependency manager.
Reads `ConsoleCLI/data/07735_data.csv` (a manually downloaded export from tides.gc.ca) and prints the next N lowest tides under a given height to stdout.
There is no CLI argument parsing; parameters are set by editing the `FindTide(...)` call at the bottom of the file directly.

**`WebApp/Tides.Api/`**
ASP.NET Core 9 minimal-hosting API (`Program.cs`), single project, no separate class library.
- `Controllers/StationsController.cs` - station search (`GET /api/stations?search=`) and the full station list the map plots (`GET /api/stations/all`).
- `Controllers/TidePredictionsController.cs` - predictions (`GET /api/tides/{code}`) and derived low-tide analysis (`GET /api/tides/{code}/analysis`).
- `Services/ITideDataSource.cs` - the contract each upstream authority implements: its full station list, predictions, and observed water level. Sources own disjoint sets of stations.
- `Services/IwlsApiService.cs` - the Canadian source. Proxies and caches (`IMemoryCache`, 24h for station data, 6h for tide predictions) calls to the external IWLS API. Self-throttles to roughly one request per 350ms via a static `SemaphoreSlim`, since it's a shared upstream rate limit. Chunks date ranges into 30-day windows because the upstream API caps request span.
Filters the station list to those carrying a `wlp` (water level prediction) time series, since roughly a third of IWLS stations have none and 404 when asked for predictions.
- `Services/NoaaApiService.cs` - the US west coast source (NOAA CO-OPS), same caching windows. No key or auth, and no chunking needed since NOAA serves a full year of 15-minute predictions per request.
Filters to reference stations (`type == "R"`) in WA/OR/CA; subordinate stations only publish high/low offsets and error on an interval request. That is 150 of the 402 stations in those states.
NOAA reports "no data at this station" as HTTP 200 with an `error` body rather than a status code, so that is checked explicitly.
- `Services/TideStationDirectory.cs` - the single entry point controllers use. Merges the sources' station lists, ranks search results before truncating to 20 (otherwise one country crowds out the other), and routes each data request back to the source that owns the station via `Station.Source`.
- `Services/TideAnalysisService.cs` - computes the overall lowest tide and per-day lowest tides for a range, bucketed into Morning/Afternoon/Evening/Night by local hour (station-specific timezone, not server timezone).
- The API also serves the built SPA as static files (`UseStaticFiles` + `MapFallbackToFile`), so the intent is a single deployable unit (see commit `757f7de`, "Add static file serving and deploy to Azure App Service"). There is no deployment workflow or publish profile checked into the repo, so the actual deploy mechanics live outside it.

**`WebApp/tides-client/`**
Vite + React 19 + TypeScript SPA, styled with Tailwind CSS v4 (via `@tailwindcss/vite`, no separate `tailwind.config`).
- Data fetching/caching via TanStack Query, plus a hand-rolled localStorage layer on top (`src/api/tideCache.ts`) to avoid redundant fetches across sessions (commit `bbf67f4`).
- Charting via Chart.js + `react-chartjs-2`, with `chartjs-plugin-zoom` for pinch/touch panning, tuned specifically for mobile viewports (several fixes: `d97a7bc`, `594e6aa`, `c73f9f7`).
- Station picker map via Leaflet/`react-leaflet`, OpenStreetMap tiles (switched from Stadia Maps in `cd6e355`), hidden behind a toggle by default (`cb18803`) rather than always shown.
- Dev server (`vite.config.ts`) proxies `/api` to `http://localhost:5062`, which is the API's local Kestrel port from `Properties/launchSettings.json`. Run the API and the client dev server side by side for local development; the client does not stand alone against a mock backend.

## Versioning

`WebApp/tides-client/package.json`'s `version` field is the single source of truth.
`vite.config.ts` reads it at build time and inlines it as the `__APP_VERSION__` global (declared in `src/vite-env.d.ts`), which `Layout.tsx` renders in the top right of the header.
Nothing reads it at runtime, and `Tides.Api` carries no version of its own, so there is exactly one number to change.

**Bump it in the same commit as the change it describes**, following semver loosely:

- patch (`1.0.x`) for fixes, refactors, and small adjustments
- minor (`1.x.0`) for user-visible features
- major (`x.0.0`) only when Q asks for it, or when something warrants it strongly enough to raise with Q first - never take a major bump on your own

`npm version <new> --no-git-tag-version` from `tides-client/` edits the file without creating a git tag, which is what you want here: the repo holds two projects and a bare `v1.2.3` tag wouldn't say which one moved.

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
No local secrets or connection string are needed, since the only external dependencies are the public IWLS and NOAA CO-OPS APIs, neither of which needs a key.

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

There is no CI/CD pipeline, publish profile, or infrastructure-as-code checked into this repo, so deployment is a manual process done from the command line.

**Target resource** (confirmed via `az webapp list`, not recorded anywhere else in the repo):
- App Service: `tides-app-ql`
- Resource group: `Tides`
- Region: Canada Central
- App Service Plan: `TidesPlan`, SKU `F1` (free tier)
- URL: https://tides-app-ql.azurewebsites.net

The site is `httpsOnly`, so plain HTTP gets a 301 to HTTPS (set 2026-08-07 via `az webapp update --resource-group Tides --name tides-app-ql --https-only true`).
Don't turn this off: the map's "show me where I am" features call the browser geolocation API, which only resolves in a secure context.
Served over plain HTTP they fail silently, leaving no location marker and a permanently disabled recentre button.

**Steps** (run from `WebApp/Tides.Api/`, after `az login` and `az account set --subscription 43c949f7-2115-4366-8461-9639f9101f0b`):

```
cd WebApp/tides-client && npm run build
cd ../Tides.Api
rm -rf wwwroot && mkdir wwwroot && cp -r ../tides-client/dist/. wwwroot/
rm -rf publish && dotnet publish -c Release -o ./publish
cd publish && powershell -Command "Compress-Archive -Path * -DestinationPath ../deploy.zip -Force" && cd ..
az webapp deploy --resource-group Tides --name tides-app-ql --src-path deploy.zip --type zip
```

`publish/`, `deploy.zip`, and `wwwroot/` are all gitignored build artifacts, delete them after a deploy.

**Gotchas hit doing this the first time (2026-07-03):**
- The Azure CLI refresh token expires after ~90 days of inactivity. If `az webapp list` or similar errors with `AADSTS700082` use az login command for an interactive login from Q.
- `tides-app-ql` has SCM/FTP **basic-auth publishing credentials disabled** (`az resource show --resource-group Tides --name scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies --parent sites/tides-app-ql` → `allow: false`). This is a deliberate security setting, don't re-enable it to work around auth failures.
- Because of that, an old Azure CLI (2.44.1, the version `winget` had installed) gets a 401 on `az webapp deploy`, it only knows the legacy Kudu basic-auth flow. CLI **2.87.0+** works, it deploys using an Azure AD token instead. If deploy gets a 401, check `az version` first and `winget upgrade --id Microsoft.AzureCLI` if it's old.
- On this machine, `winget upgrade` moved the install from `C:\Program Files (x86)\...` (32-bit) to `C:\Program Files\...` (64-bit) and the old path no longer exists. A shell with the old PATH cached won't find `az` after upgrading, prepend the new `...\Microsoft SDKs\Azure\CLI2\wbin` to `PATH` for the session (or open a fresh terminal).

## Testing

There are currently no automated tests anywhere in this repo: no test project in `WebApp/Tides.sln`, no test script or framework in `tides-client/package.json`, no tests for the Python CLI.

What exists today as a proxy for correctness:
- `tides-client`: `npm run lint` (ESLint) and `npm run build` (`tsc -b && vite build`, which surfaces type errors but doesn't verify behavior).
- `Tides.Api`: `dotnet build` from `WebApp/` only confirms it compiles; nothing exercises the controllers or services.
- `ConsoleCLI/Tides.py`: no automated check at all. Verification is running the script and reading its stdout.

If asked to change behavior in `TideAnalysisService` (timezone/day-bucketing math), `IwlsApiService` / `NoaaApiService` (rate limiting, chunking, caching, station filtering), or `TideStationDirectory` (search ranking, source routing), be aware there is no regression safety net today; manual verification against the running app is the only option unless tests are added first.
