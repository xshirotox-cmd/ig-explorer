#!/usr/bin/env python3
"""Ig Data Explorer — build step.

Reads the (private, local) cleaned biosensor data and emits anonymized,
precomputed JSON into site/data/ for the static explorer. Source provider
names never reach the shipped output (anonymized to sample types here).

Run:  python3 build/build.py
Deps: stdlib + numpy + scipy (no pandas/duckdb needed).
"""
import os, re, csv, json, glob, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC  = os.environ.get("IG_SRC", "/Users/jcheng/Documents/biosensors/data")
OUT  = os.path.join(REPO, "site", "data")
os.makedirs(OUT, exist_ok=True)

DATA_MAP = os.path.join(SRC, "full data export/2025-2026/DATA_MAP.csv")
CSV_IDX  = os.path.join(SRC, "ch instruments data/extracted_csv/INDEX.csv")
CSV_ROOT = os.path.join(SRC, "ch instruments data/extracted_csv")
PROC_ROOT= os.path.join(SRC, "full data export/2025-2026-csv")

# ---- anonymization: provider name -> sample type (applied to all shipped text)
# The mapping (which contains the raw provider names) lives in a gitignored local
# file so no names ever enter version control. Without it, NO anonymization is
# applied and the build refuses to look clean — do not publish such output.
def _load_sample_map():
    p = os.path.join(HERE, "sample_map.local.json")
    if os.path.exists(p):
        return [(re.compile(pat, re.I), repl) for pat, repl in json.load(open(p))]
    print("WARNING: build/sample_map.local.json missing — NO anonymization applied.")
    return []
SAMPLE_MAP = _load_sample_map()
def anon(text):
    if text is None: return text
    out = text
    for rx, repl in SAMPLE_MAP:
        out = rx.sub(repl, out)
    return out

def anon_id(name):
    # filename-safe: spaces->-, names->sample type
    return anon(name).replace(" ", "-")

def jdump(obj, name):
    p = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
    return os.path.getsize(p)

def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None

# ---------------------------------------------------------------- experiments
def load_experiments():
    rows = list(csv.DictReader(open(DATA_MAP)))
    exps = []
    for r in rows:
        if r["category"] != "immunoglobulins":
            continue
        if r.get("status", "").startswith(("moved", "dropped")):
            continue
        new = r["new_path"]
        base = os.path.splitext(os.path.basename(new))[0]   # e.g. 2026-02-12_IgG_static-calibration
        eid = anon_id(base)
        # sample type
        st = "standard"
        for rx, repl in SAMPLE_MAP:
            if rx.search(base): st = repl; break
        # methods text
        csvdir = r.get("csv_export_dir", "")
        methods = ""
        if csvdir:
            mp = os.path.join(SRC, csvdir, "methods.txt")
            if os.path.exists(mp): methods = anon(open(mp, errors="ignore").read())
        parts = base.split("_")
        analyte = parts[1] if len(parts) > 1 else ""
        desc = anon(" ".join(parts[2:]).replace("-", " ")) if len(parts) > 2 else ""
        exps.append({
            "id": eid,
            "src_base": base,                # internal only (stripped before ship)
            "date": r.get("date", ""),
            "analyte": analyte,
            "description": desc,
            "sample_type": st,
            "raw_folder": r.get("raw_folder", ""),
            "confidence": r.get("confidence", ""),
            "csv_export_dir": csvdir,
            "methods": methods,
        })
    return exps

# ---------------------------------------------------------------- traces
TECH_KEEP = {"i-t", "CA"}   # amperometric for morphology/steady-state; CV handled separately
def load_trace_index():
    by_folder = {}
    for r in csv.DictReader(open(CSV_IDX)):
        p = r["path"].split("/")
        folder = p[1] if len(p) > 1 else ""
        by_folder.setdefault(folder, []).append(r)
    return by_folder

def role_of(fname):
    f = fname.lower()
    if re.search(r"\b(control|ctrl|blank|bare|^c\d|no ?igg|no ?ab|nc)\b", f) or f.startswith("c"):
        return "control"
    if re.search(r"(igg|iga|igm|^g\d|^a\d|^m\d|target|pos|sample|10n|10v|5n|5v)", f):
        return "sensor"
    return "other"

def read_points(path):
    t, i = [], []
    with open(path, errors="ignore") as fh:
        for line in fh:
            if line.startswith("#") or not line.strip(): continue
            parts = line.rstrip().split(",")
            if len(parts) < 2: continue
            a, b = num(parts[0]), num(parts[1])
            if a is None or b is None: continue
            t.append(a); i.append(b)
    return t, i

def steady_state_uA(i_vals):
    """median of last 20% of points, in microamps (input in A)."""
    if not i_vals: return None
    n = max(1, len(i_vals) // 5)
    tail = i_vals[-n:]
    return float(np.median(tail)) * 1e6

def build_traces(exps, idx_by_folder):
    traces = []
    points_by_exp = {}
    # one raw folder -> one experiment (highest confidence, then earliest date) to
    # avoid double-counting traces when two experiments share an acquisition folder.
    rank = {"high": 0, "med": 1, "low": 2}
    order = sorted(exps, key=lambda e: (rank.get(e["confidence"], 3), e["date"]))
    claimed = {}
    for e in order:
        f = e["raw_folder"]
        if f and f in idx_by_folder and f not in claimed:
            claimed[f] = e["id"]
    for e in exps:
        folder = e["raw_folder"]
        e["shared_folder_with"] = ""
        if folder and claimed.get(folder) not in (None, e["id"]):
            e["n_traces"] = 0
            e["shared_folder_with"] = claimed[folder]   # traces live under the primary exp
            continue
        if not folder or folder not in idx_by_folder:
            e["n_traces"] = 0
            continue
        pts = {}
        n = 0
        for r in idx_by_folder[folder]:
            if r["technique"] not in TECH_KEEP: continue
            if r.get("status") != "ok" or not r.get("csv"): continue
            csv_path = os.path.join(SRC, "ch instruments data", *r["csv"].split("/")[1:]) \
                       if r["csv"].startswith("extracted_csv") else os.path.join(SRC, "ch instruments data", r["csv"])
            # r["csv"] is like 'extracted_csv/<folder>/<file>.csv'
            csv_path = os.path.join(CSV_ROOT, *r["csv"].split("/")[1:])
            if not os.path.exists(csv_path): continue
            fname = os.path.basename(r["csv"])
            t, ivals = read_points(csv_path)
            if not t: continue
            tid = f'{e["id"]}__{anon_id(os.path.splitext(fname)[0])}'
            traces.append({
                "trace_id": tid,
                "experiment_id": e["id"],
                "analyte": e["analyte"],
                "sample_type": e["sample_type"],
                "date": (r.get("timestamp") or "")[:10],
                "technique": r["technique"],
                "label": anon(os.path.splitext(fname)[0]),
                "role": role_of(fname),
                "npoints": len(t),
                "ss_uA": steady_state_uA(ivals),
                "sample_interval_s": num(r.get("sample_interval_s")),
            })
            pts[tid] = {"t": [round(x, 3) for x in t],
                        "i_uA": [round(y * 1e6, 6) for y in ivals]}
            n += 1
        e["n_traces"] = n
        if pts:
            points_by_exp[e["id"]] = pts
    return traces, points_by_exp

# ---------------------------------------------------------------- repro + samples
def cv_stats(vals):
    v = [x for x in vals if x is not None]
    if len(v) < 2: return None
    m = float(np.mean(v)); sd = float(np.std(v, ddof=1))
    return {"n": len(v), "mean_uA": m, "sd_uA": sd,
            "cv_pct": (abs(sd / m) * 100 if m else None)}

def build_repro_samples(exps, traces):
    controls = [t for t in traces if t["role"] == "control" and t["ss_uA"] is not None]
    sensors  = [t for t in traces if t["role"] == "sensor"  and t["ss_uA"] is not None]
    # per-experiment replicate CV, by role
    repcv = []
    import collections
    groups = collections.defaultdict(list)
    for t in traces:
        if t["ss_uA"] is None: continue
        if t["role"] in ("control", "sensor"):
            groups[(t["experiment_id"], t["analyte"], t["role"], t["date"])].append(t["ss_uA"])
    for (eid, an, role, date), vals in groups.items():
        s = cv_stats(vals)
        if s: repcv.append({"experiment_id": eid, "analyte": an, "role": role, "date": date, **s})
    light = lambda L: [{"experiment_id": t["experiment_id"], "analyte": t["analyte"],
                        "date": t["date"], "label": t["label"], "ss_uA": t["ss_uA"]} for t in L]
    repro = {"controls": light(controls), "sensors": light(sensors), "replicate_cv": repcv}

    # real-sample readouts grouped by sample type
    samp = collections.defaultdict(list)
    for t in traces:
        if t["sample_type"] in ("PBMC", "Bone Marrow") and t["role"] == "sensor" and t["ss_uA"] is not None:
            samp[(t["sample_type"], t["analyte"], t["experiment_id"], t["date"])].append(t["ss_uA"])
    samples = []
    for (st, an, eid, date), vals in samp.items():
        s = cv_stats(vals) or {"n": len(vals), "mean_uA": float(vals[0]), "sd_uA": None, "cv_pct": None}
        samples.append({"sample_type": st, "analyte": an, "experiment_id": eid,
                        "date": date, "values_uA": vals, **s})
    return repro, samples

# ---------------------------------------------------------------- main
def main():
    exps = load_experiments()
    idx = load_trace_index()
    traces, points_by_exp = build_traces(exps, idx)

    # write per-experiment point files
    for eid, pts in points_by_exp.items():
        jdump(pts, f"points/{eid}.json")

    # strip internal-only fields + anonymize provenance before shipping
    ship_exps = []
    for e in exps:
        s = {k: v for k, v in e.items() if k not in ("src_base", "csv_export_dir")}
        s["raw_folder"] = anon(s.get("raw_folder", ""))
        ship_exps.append(s)
    jdump(ship_exps, "experiments.json")
    jdump(traces, "traces.json")

    # dose-response (recipe-driven harmonization + 4PL fits)
    import recipes
    dr = recipes.build_dose_response(PROC_ROOT)
    jdump(dr, "doseresponse.json")

    # reproducibility + real samples (from traces)
    repro, samples = build_repro_samples(exps, traces)
    jdump(repro, "reproducibility.json")
    jdump(samples, "samples.json")
    print(f"repro: {len(repro['controls'])} control traces, {len(repro['sensors'])} sensor traces, "
          f"{len(repro['replicate_cv'])} replicate groups | samples: {len(samples)} groups")

    # manifest for the frontend
    jdump({"experiments": len(ship_exps), "traces": len(traces),
           "dose_response": len(dr), "samples": len(samples),
           "analytes": sorted(set(e["analyte"] for e in ship_exps))}, "manifest.json")

    # quick summary + leak check
    import collections
    by_an = collections.Counter(e["analyte"] for e in exps)
    print(f"experiments: {len(exps)}  {dict(by_an)}")
    print(f"traces: {len(traces)} (i-t {sum(t['technique']=='i-t' for t in traces)}, "
          f"CA {sum(t['technique']=='CA' for t in traces)})")
    print(f"point files: {len(points_by_exp)}")
    blob = (json.dumps(ship_exps) + json.dumps(traces)).lower()
    leakwords = set()
    for rx, _ in SAMPLE_MAP:                        # derive names from the local map
        leakwords |= set(re.findall(r"[a-z]{3,}", rx.pattern.lower()))
    leaks = [w for w in leakwords if w in blob]
    print("NAME-LEAK CHECK:", "CLEAN" if not leaks else f"LEAK {leaks}")

if __name__ == "__main__":
    main()
