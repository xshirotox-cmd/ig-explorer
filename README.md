# Ig Biosensor Data Explorer

A static, client-side web app for exploring the immunoglobulin (IgG / IgM / IgA)
electrochemical immunosensor data: experiments, i-t curve morphology,
dose-response curves with fits, control/replicate reproducibility, and real-sample
response. Built to run **locally** and to deploy to **GitHub Pages** (private repo)
unchanged.

This is **v1, scoped to immunoglobulins**. The pipeline is built to extend to
cytokines / metabolites / etc. by adding recipes (see *Extending*).

## How it works

```
   private local data (data/…)              committed to repo
  ┌───────────────────────────┐         ┌──────────────────────────┐
  │ DATA_MAP.csv               │         │ site/                    │
  │ extracted_csv/INDEX.csv    │  build  │   index.html app.js css  │
  │ extracted_csv/<traces>     │ ─────▶  │   data/*.json  (built)   │
  │ 2025-2026-csv/<methods>    │ python  │   data/points/*.json     │
  └───────────────────────────┘         └──────────────────────────┘
      (never shipped)                      static site → Pages / localhost
```

- **`build/build.py`** reads the cleaned source data (the private `data/` tree),
  harmonizes it, and writes precomputed, **anonymized** JSON into `site/data/`.
  Source provider names never reach the output — they are mapped to sample types
  (provider name → sample type, via a local gitignored map) at build time, and the
  build prints a `NAME-LEAK CHECK`.
- **`site/`** is a dependency-free static app (vanilla JS + Plotly from CDN). It
  loads the JSON and renders interactively in the browser. No server, no Node.

## Rebuild the data

Requires Python 3 with `numpy`, `scipy`, `openpyxl` (see `build/requirements.txt`).

```bash
# point at the source data tree (default is the absolute path used during build)
export IG_SRC="/path/to/biosensors/data"
python3 build/build.py
```

Outputs land in `site/data/`. The build is deterministic and idempotent.

## Run locally

```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

(Plotly loads from a CDN, so an internet connection is needed for charts; the data
is local.)

## Deploy to GitHub Pages

The site is pre-built (the Python build runs locally because it needs the private
source data), so CI only publishes `site/`. Push to a **private** repo with Pages
enabled; `.github/workflows/deploy.yml` uploads `site/` as the Pages artifact.

## Views

- **Overview** — all experiments, filterable by analyte; links to detail.
- **i-t Morphology** — overlay every electrode trace for an experiment plus a
  mean ± SD band (traces resampled to a common time grid); group by sensor/control.
- **Dose-Response** — calibration curves with 4PL (≥4 pts, R²≥0.5) or semi-log
  linear fit, EC50/R², multiple conditions (substrate, flow vs static) overlaid.
- **Reproducibility** — steady-state current control chart across dates with
  mean ± 2SD bands; replicate CV table.
- **Real Samples** — measured signal by sample type (PBMC / Bone Marrow).
- **Experiment detail** — per-experiment traces, methods, provenance.

## Data notes / caveats

- **Steady-state current** = median of each trace's final 20 % of points, in µA.
- **Fits**: a 4PL is kept only with ≥4 points and R² ≥ 0.5; otherwise a semi-log
  linear fit is shown. A low-R² fit means the data showed no real dose dependence.
- **Shared acquisition folders**: when two experiments were recorded into one CHI
  folder (medium-confidence mappings), the traces are assigned to the
  higher-confidence experiment and the other is flagged (`shared folder`).
- **Sensor replicate CV** pools all concentrations in an acquisition, so it
  reflects dose spread, not pure replicate error — controls are the cleaner metric.

## Extending to other analytes

1. In `build/build.py`, `load_experiments()` filters `category == "immunoglobulins"`.
   Broaden/parametrize this to include other categories.
2. Add dose-response parsers in `build/recipes.py` and register them in `RECIPES`.
3. Re-run the build. The frontend is analyte-agnostic and will pick them up.

## Layout

```
ig-explorer/
  build/build.py        # harmonize + emit JSON (anonymizing)
  build/recipes.py      # per-experiment dose-response parsers + fits
  build/harness.js      # headless jsc smoke test of the UI
  build/requirements.txt
  site/index.html site/app.js site/style.css
  site/data/            # generated JSON (committed)
  .github/workflows/deploy.yml
```
