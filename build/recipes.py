"""Per-experiment dose-response recipes for the Ig calibration workbooks.

Each parser returns a list of "curves":
  {"condition": str, "units": "uA",
   "points": [{"conc": float, "mean": float, "sd": float|None, "n": int, "values":[...]}],
   "fit": {a,b,c,d,ec50,r2}|None}
Units are normalized to microamps (uA) regardless of the source units.
"""
import os, csv, math, warnings
import numpy as np
from scipy.optimize import curve_fit
warnings.filterwarnings("ignore")

def _num(x):
    try:
        v = float(x); return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None

def _fpl(x, a, b, c, d):
    return d + (a - d) / (1.0 + (x / c) ** b)

def fit_4pl(conc, resp):
    x = np.array(conc, float); y = np.array(resp, float)
    m = (x > 0) & np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < 4:
        return None
    p0 = [float(y.min()), 1.0, float(np.median(x)), float(y.max())]
    try:
        popt, _ = curve_fit(_fpl, x, y, p0=p0, maxfev=30000)
    except Exception:
        return None
    yp = _fpl(x, *popt)
    ss_res = float(np.sum((y - yp) ** 2)); ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = (1 - ss_res / ss_tot) if ss_tot > 0 else None
    a, b, c, d = [float(v) for v in popt]
    if r2 is None or r2 < 0.5:          # reject non-fits (flat/noisy data)
        return None
    return {"type": "4pl", "a": a, "b": b, "c": c, "d": d, "ec50": abs(c), "r2": r2}

def fit_loglinear(conc, resp):
    x = np.array(conc, float); y = np.array(resp, float)
    m = (x > 0) & np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < 3:
        return None
    lx = np.log10(x)
    A = np.vstack([lx, np.ones_like(lx)]).T
    slope, intercept = np.linalg.lstsq(A, y, rcond=None)[0]
    yp = slope * lx + intercept
    ss_res = float(np.sum((y - yp) ** 2)); ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = (1 - ss_res / ss_tot) if ss_tot > 0 else None
    return {"type": "loglinear", "slope": float(slope), "intercept": float(intercept), "r2": r2}

def _rows(path):
    return list(csv.reader(open(path, errors="ignore")))

def _curve(points):
    pts = [p for p in points if p["mean"] is not None and p["conc"] is not None]
    pts.sort(key=lambda p: p["conc"])
    x = [p["conc"] for p in pts]; y = [p["mean"] for p in pts]
    fit = fit_4pl(x, y) or fit_loglinear(x, y)
    return pts, fit

def _agg(vals, scale):
    v = [x * scale for x in vals if x is not None]
    if not v: return None, None, 0, []
    return float(np.mean(v)), (float(np.std(v, ddof=1)) if len(v) > 1 else None), len(v), v

# ---- individual parsers (col indices verified against the actual files) -------
def low_calibration(path):                       # IgG | S1 | S2 | Avg | SD ...  (S in A)
    pts = []
    for r in _rows(path)[1:]:
        c = _num(r[0]);  reps = [_num(r[1]), _num(r[2])]
        if c is None: continue
        mean, sd, n, vals = _agg(reps, 1e6)      # A -> uA
        pts.append({"conc": c, "mean": mean, "sd": sd, "n": n, "values": vals})
    p, f = _curve(pts)
    return [{"condition": "standard", "units": "uA", "points": p, "fit": f}]

def igm_substrates(path):                         # Concentration | Carbon | CNF | SW-CNT (A)
    series = {"Carbon": 1, "CNF": 2, "SW-CNT": 3}
    acc = {k: [] for k in series}
    for r in _rows(path)[1:]:
        c = _num(r[0])
        if c is None: continue
        for cond, ci in series.items():
            v = _num(r[ci]) if ci < len(r) else None
            mean, sd, n, vals = _agg([v], 1e6)
            acc[cond].append({"conc": c, "mean": mean, "sd": sd, "n": n, "values": vals})
    out = []
    for cond, pts in acc.items():
        p, f = _curve(pts)
        out.append({"condition": cond, "units": "uA", "points": p, "fit": f})
    return out

def static_calibration(path):  # IgG/ng/mL | Flow(full) | Flow(meas) | Static | FULL SD | STAT SD | FIN SD (uA)
    cfg = [("Flow (full process)", 1, 4), ("Flow (measurement only)", 2, 6), ("Static", 3, 5)]
    acc = {c[0]: [] for c in cfg}
    for r in _rows(path)[1:]:
        c = _num(r[0])
        if c is None: continue
        for cond, vi, sdi in cfg:
            mean = _num(r[vi]) if vi < len(r) else None
            sd = _num(r[sdi]) if sdi < len(r) else None
            acc[cond].append({"conc": c, "mean": mean, "sd": sd, "n": 0, "values": []})
    out = []
    for cond, pts in acc.items():
        p, f = _curve(pts)
        out.append({"condition": cond, "units": "uA", "points": p, "fit": f})
    return out

def elisa_range(path):           # IgG | R1 | R2 | Avg | SD | _ | Sample block...  (uA)
    pts = []
    for r in _rows(path)[1:]:
        c = _num(r[0])
        if c is None: continue
        mean, sd, n, vals = _agg([_num(r[1]), _num(r[2])], 1.0)   # already uA
        pts.append({"conc": c, "mean": mean, "sd": sd, "n": n, "values": vals})
    p, f = _curve(pts)
    return [{"condition": "standard", "units": "uA", "points": p, "fit": f}]

# experiment_id (anon) -> (relative file under PROC_ROOT, parser, analyte, date)
RECIPES = [
    ("2025-07-14_IgG_low-calibration", "immunoglobulins/igg/2025-07-14_IgG_low-calibration/02_Data.csv", low_calibration, "IgG", "2025-07-14"),
    ("2025-05-14_IgM_calibration-substrates", "immunoglobulins/igm/2025-05-14_IgM_calibration-substrates/02_Calibration.csv", igm_substrates, "IgM", "2025-05-14"),
    ("2026-02-12_IgG_static-calibration", "immunoglobulins/igg/2026-02-12_IgG_static-calibration/03_Summary Data.csv", static_calibration, "IgG", "2026-02-12"),
    ("2025-08-04_IgG_sensor-calibration-elisa-range", "immunoglobulins/igg/2025-08-04_IgG_sensor-calibration-elisa-range/06_Data.csv", elisa_range, "IgG", "2025-08-04"),
]

def build_dose_response(PROC_ROOT):
    out = []
    for eid, rel, parser, analyte, date in RECIPES:
        path = os.path.join(PROC_ROOT, rel)
        if not os.path.exists(path):
            print("  [dose-response] MISSING", rel); continue
        curves = parser(path)
        ncurves = sum(1 for c in curves if c["points"])
        out.append({"experiment_id": eid, "analyte": analyte, "date": date, "curves": curves})
        fits = sum(1 for c in curves if c["fit"])
        print(f"  [dose-response] {eid}: {ncurves} curve(s), {fits} fit(s)")
    return out
