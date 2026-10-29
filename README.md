# SafeRoute AI

**Predict Traffic. Detect Hazards. Navigate Smarter.**

Cyberjaya 5G Future Talent Innovation Challenge 2026 · Track 2: Connected & Safe Mobility · Team CrocodileTeam

SafeRoute AI combines community hazard reporting, AI photo analysis, live route alerts and congestion forecasting
into a single routing engine for walking and driving in a Cyberjaya pilot area.

> **Demo data notice.** Roads, footpaths and places are real OpenStreetMap data. Seeded hazards, all traffic
> observations and traffic forecasts are **synthetic** and labelled as such throughout the app. No live traffic
> feed is connected.

---

## What works

| Area | Implemented |
|---|---|
| Smart Navigation | Walk / drive route comparison (Fastest, Safest, Smart Balance) on a real OSM graph, safety scores with factor breakdown, start/end navigation sessions, live alerts, one-tap rerouting |
| Hazard reporting | Photo upload (re-encoded, EXIF/GPS stripped) → optional AI suggestion → category / severity / obstruction → pin with live path-match preview → duplicate merge |
| AI image analysis | Claude vision with strict JSON-schema output, validation, timeout / refusal / invalid-output handling. Without a key the app says so and the user classifies manually |
| Real-time | WebSocket alerts targeted to sessions whose route crosses the affected segments, reconnect with backoff, duplicate suppression, unread counts, notification centre |
| Hazard-aware routing | Reports linked to real path segments (≤ 12 m reliable, ≤ 25 m approximate). Unverified → warning; verified → caution; operator-confirmed closure → excluded. Closures are never auto-reopened |
| Traffic AI | Synthetic 35-day history for 27 named corridors, historical-average baseline vs RandomForest, 15/30/60-min horizons (and extended), uncertainty from tree spread, time-dependent routing (speed at the time you enter each road), congestion heatmap, best time to leave, evaluation table |
| Operations | Verification queue, location correction, verify/reject/merge, severity & restriction, maintenance assignment, completion evidence, resolve, reopen path, full incident history, analytics, reset demo data |
| Maps | Google Maps base map + Google Places search when a browser key is configured; otherwise a clearly labelled Leaflet / OpenStreetMap demo map. Routes are drawn from the SafeRoute engine in both cases |
| Roles | Student, driver, safety operator, maintenance — enforced server-side on every endpoint |

## Architecture

```
frontend/  React 18 + TypeScript + Vite + Tailwind, Google Maps JS API or Leaflet, Recharts
  src/components/map/primitives.tsx  markers / lines that render on either base map
backend/   FastAPI, SQLAlchemy 2, scikit-learn, Anthropic SDK
  app/services/graph.py          OSM walk & drive networks, spatial grid index
  app/services/routing.py        time-dependent A* with risk-weighted costs
  app/services/safety.py         explainable heuristic safety score
  app/services/incidents.py      path matching, lifecycle, targeted alerts, rerouting
  app/services/traffic_sim.py    reproducible synthetic traffic generator
  app/services/traffic_model.py  baseline + RandomForest, evaluation, forecaster
  app/services/ai_vision.py      Claude hazard photo classification
  app/services/realtime.py       WebSocket manager / event bus
  scripts/build_graph.py         builds graphs from data/raw/*.json (OSM extract)
  migrations/001_postgis.sql     PostGIS columns + spatial indexes for Postgres
```

Walking and driving networks are separate graphs (walk: 3,163 nodes / 8,772 edges; drive: 2,591 nodes /
5,047 directed edges, honouring one-ways), each restricted to its largest strongly connected component.
Routes are only ever drawn from engine edges; the short dashed connector from your exact pin to the nearest
network node is shown dashed because it is not a mapped road.

### Google Maps

Set `GOOGLE_MAPS_BROWSER_KEY` (and ideally `GOOGLE_MAPS_MAP_ID`) in `backend/.env` and restart the API.
The key is delivered to signed-in users at runtime through `/api/map/config`, so the frontend needs no
rebuild. It is a **browser key and is public by design**, so in Google Cloud Console:

- enable **Maps JavaScript API** and **Places API (New)**;
- restrict the key to those two APIs and to your site's HTTP referrers (e.g. `http://localhost:5173/*`
  and your production domain);
- create a Map ID (JavaScript, vector or raster) for Advanced Markers; without one the app uses
  `DEMO_MAP_ID`, which is for development only. Cloud-based map styling attached to the Map ID can
  give the base map the pastel look.

What Google provides: the base map and place search (Places autocomplete restricted to the pilot area,
results outside it are refused). What it does **not** provide: routes, travel times or traffic — those
still come from the SafeRoute engine on the OpenStreetMap network and the synthetic traffic model, so
route lines can sit a few metres off Google's road drawing where the two maps differ. If the key is
missing, rejected or Google can't be reached, the app falls back to the OSM demo map and says why.

### Safety score

`Safety = 100 × (1 − weighted risk)` with weights: active hazards 35%, past incidents 25%, lighting 15%,
weather 15%, path condition 10%. Unknown lighting/surface counts as 0.5 risk and lowers "data confidence".
It is a heuristic, not an accident probability.

### Traffic model (synthetic)

Held-out final week, MAE in km/h (lower is better):

| Horizon | RandomForest | Baseline |
|---|---|---|
| +15 min | 1.85 | 2.21 |
| +30 min | 1.85 | 2.21 |
| +60 min | 1.85 | 2.21 |

The model takes the weather and incident flags at the target time as inputs (i.e. it assumes a weather
forecast is available). Active SafeRoute incidents on a corridor (accident, flood, fallen tree, construction,
debris) are fed into the model, so a reported crash slows predicted traffic on that road.

## Run locally

Requirements: Python 3.11+ and Node 20+.

```bash
# backend
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # optional: ANTHROPIC_API_KEY (AI photos), GOOGLE_MAPS_BROWSER_KEY (Google Maps)
python -m app.seed                # creates saferoute.db, seeds demo data, trains the model (~30 s first time)
uvicorn app.main:app --port 8000  # API docs at http://localhost:8000/docs

# frontend (new terminal)
cd frontend
npm install
npm run dev                       # http://localhost:5173 (proxies /api, /uploads, /ws to :8000)
```

Demo accounts (password `demo1234`, also one-click on the login page):

| Role | Email |
|---|---|
| Student A (reports) | student.a@demo.saferoute.my |
| Student B (navigates) | student.b@demo.saferoute.my |
| Driver | driver@demo.saferoute.my |
| Safety operator | operator@demo.saferoute.my |
| Maintenance | maintenance@demo.saferoute.my |

Operators can restore the dataset from **Admin Dashboard → Reset demo data** (demo mode only).

### Tests

```bash
cd backend && python -m pytest -q        # 15 API tests: auth, roles, matching, routing, AI fallback,
                                         # duplicates, live alerts, closures, rerouting, lifecycle,
                                         # traffic forecasts, best departure, dashboards
cd frontend && npm run build             # type-check + production build
```

## Demo scripts

**Demo A — Fallen tree.** Open two browser windows (use a private window for the second).
1. Window 1: sign in as **Student B** → Smart Navigation → *Try a demo trip* (Multimedia University → DPulze) → **Start navigation**.
2. Window 2: sign in as **Student A** → Report Hazard → upload a photo (AI suggests a category if a key is set) → *Fallen Tree*, High, Fully blocked → tap the map on Persiaran Multimedia along B's route (the panel confirms the path match) → Submit.
3. Window 1 immediately shows *Hazard reported on your route* with an alternative → **Use alternative route**.
4. Window 2: switch to **Operator** → Verification → Verify → *Confirm closure*. Routes now exclude that path.
5. Operator → Maintenance → Assign. Switch to **Maintenance** → Start work → notes/photo → Request clearance.
6. Operator → Accept & resolve (path stays closed) → **Reopen path**. Route options update live.

**Demo B — Congestion.** Sign in as **Driver** → Traffic AI. Set departure *Later* around 17:30 (or weather *Rain*):
the heatmap, predicted peak, journey-time chart and AI insight update. Use **Best time to leave** with an
arrive-by time, then **Use … departure** and **Open route in navigation**.

## Deployment

`docker compose up --build` runs PostgreSQL/PostGIS, the API and an nginx-served frontend
(http://localhost:5173). The API container reseeds demo data on start. After the first start you can apply
`backend/migrations/001_postgis.sql` for spatial columns and indexes. For production: set a long
`JWT_SECRET`, `DEMO_MODE=false`, a referrer-restricted `GOOGLE_MAPS_BROWSER_KEY` + `GOOGLE_MAPS_MAP_ID`
(or your own tile server via `VITE_MAP_TILE_URL` for the OSM map — OpenStreetMap's public tiles are for
light use only), and keep `ANTHROPIC_API_KEY` server-side.

## Known limitations

- Google Maps is used only as the base map and place search. Routing, ETAs and traffic do not use Google
  Directions/Routes or Google live traffic. The Google path was checked in Google's keyless development
  mode only (no production key was available); Places search needs a real key.
- Without a Google key, place search uses 265 named OSM places inside the pilot area.
- Cycling and motorcycle modes are not routed yet (the graph builder can add them).
- The PostgreSQL/Docker path is provided but was not exercised in development (SQLite was used).
  The schema is created from SQLAlchemy models rather than versioned Alembic migrations.
- Uploaded photos are served from `/uploads` to anyone with the URL.
- Rate limiting is in-memory (per process).

Map and place data © OpenStreetMap contributors, available under the ODbL.
