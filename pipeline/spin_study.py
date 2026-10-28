"""
Spin study: once both pitches' own stuff, the situation and the tunnel are known, does the spin relationship between
back-to-back pitches add anything, and which part of it, in which direction? Separate models for each of the six most
common pitch combos. Also measures how much the tunnel itself adds to each outcome.

Choices (Cade, 2026-10-28): P4 only, 2025-2026 games, every back-to-back pair in the same at-bat, both pitches' own stuff
included, four outcomes, spin gaps with size and direction, LightGBM tested on pitchers it never saw, per combo.

Outcomes, each its own model:
  chase       swing (1) vs take, second pitch out of the zone
  whiff       whiff (1) vs contact, when he swings
  zone_take   take (1) vs swing, second pitch in the zone
  ev          exit velo (mph), balls in play with a reading

Feature groups (each pitch is A = first, B = second):
  base    B and A own stuff (velo, IVB, HB, spin rate, efficiency, tilt as sin/cos, release height, side, distance),
          B location (side, height), balls, strikes, batter side, pitcher hand
  tunnel  apart at 23.8 ft, apart at the plate, release-angle gap, approach-angle gap
  spin    tilt gap (signed B−A, and size), gyro gap, efficiency gap, spin-rate gap (signed), total axis gap

Models compared on held-out pitchers (5 folds, grouped by pitcher):
  M0 = base, M1 = base + tunnel, M2 = M1 + spin, plus M1 + each spin piece alone.
Lift = drop in held-out log loss (or RMSE for EV) in %, and how many of the 5 folds improved.
Direction: for each spin feature in M2, average SHAP effect by fifths of the feature, in percentage points
(log-odds converted at the average rate) or mph.
Results go out as GitHub annotations and to R2 at studies/spin_study.json.gz.
"""
import json, math, os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync  # noqa: E402

PLATE_X, DEC_X = sync.PLATE_X, sync.DEC_X
FAM = sync.FAM
YEARS = ("2025", "2026")
TOP = 6


def rows_to_pairs(pitches, throws, pid):
    rs = [p for p in pitches if p.get("coeffs") and p.get("spin") and str(p.get("date", ""))[:4] in YEARS
          and not p.get("scrimmage") and p.get("opponent") not in ("West Virginia", "WES_MOU", "WVN_MN2")
          and None not in (p.get("game"), p.get("inning"), p.get("half"), p.get("pa"), p.get("pitchNo"))]
    if len(rs) < 2: return None
    rs.sort(key=lambda p: (str(p["game"]), p["inning"], str(p["half"]), p["pa"], p["pitchNo"]))
    key = [(str(p["game"]), p["inning"], str(p["half"]), p["pa"]) for p in rs]
    pn = np.array([p["pitchNo"] for p in rs])
    ok = np.array([key[i] == key[i + 1] for i in range(len(rs) - 1)]) & (np.diff(pn) == 1)
    i = np.nonzero(ok)[0]; j = i + 1
    if not len(i): return None
    C = {k: np.array([float(p["coeffs"].get(k, np.nan)) for p in rs]) for k in ["Xc0", "Xc1", "Xc2", "Yc0", "Yc1", "Yc2", "Zc0", "Zc1", "Zc2"]}
    spin = np.array([float(p["spin"]) for p in rs])

    with np.errstate(invalid="ignore", divide="ignore"):
        def t_at(d):
            a, b, k = C["Xc2"], C["Xc1"], C["Xc0"] - d
            disc = np.sqrt(np.clip(b * b - 4 * a * k, 0, None)); t1, t2 = (-b - disc) / (2 * a), (-b + disc) / (2 * a)
            lo, hi = np.minimum(t1, t2), np.maximum(t1, t2)
            return np.where(lo >= -1e-9, np.maximum(lo, 0), np.maximum(hi, 0))
        pos = lambda t: (C["Yc0"] + C["Yc1"] * t + C["Yc2"] * t * t, -(C["Zc0"] + C["Zc1"] * t + C["Zc2"] * t * t))
        tD, tP = t_at(DEC_X), t_at(PLATE_X)
        hD, sD = pos(tD); hP, sP = pos(tP)
        vel = lambda t: (-(C["Xc1"] + 2 * C["Xc2"] * t), C["Yc1"] + 2 * C["Yc2"] * t, -(C["Zc1"] + 2 * C["Zc2"] * t))
        vx0, vy0, vs0 = vel(0); vxP, vyP, vsP = vel(tP)
        vra, hra = np.degrees(np.arctan2(vy0, vx0)), np.degrees(np.arctan2(vs0, vx0))
        vaa, haa = np.degrees(np.arctan2(vyP, vxP)), np.degrees(np.arctan2(vsP, vxP))
        # spin: tilt and efficiency, same math as src/lib/spin.ts (standard air)
        tm = tP / 2
        v = np.stack([C["Xc1"] + 2 * C["Xc2"] * tm, C["Yc1"] + 2 * C["Yc2"] * tm, C["Zc1"] + 2 * C["Zc2"] * tm])
        acc = np.stack([2 * C["Xc2"], 2 * C["Yc2"] + 32.174, 2 * C["Zc2"]])
        vv = np.sqrt((v ** 2).sum(0)); m = acc - ((acc * v).sum(0) / vv ** 2) * v
        tilt = np.arctan2(-m[2], m[1])
        K = 0.5 * 0.0745 * np.pi * 0.1210 ** 2 / 0.3203
        cl = np.sqrt((m ** 2).sum(0)) / (K * vv ** 2)
        wT = np.where(cl < 0.336, vv / (0.1210 * 6.041) * np.log(0.336 / np.clip(0.336 - cl, 1e-9, None)), np.inf)
        eff = np.clip(wT * 60 / (2 * np.pi) / spin, 0, 1)
        gyro = np.degrees(np.arccos(eff))
        axis = np.stack([-np.cos(tilt) * np.cos(np.radians(gyro)), np.sin(tilt) * np.cos(np.radians(gyro)), np.sin(np.radians(gyro))])

    f = lambda key: np.array([float(p.get(key)) if p.get(key) is not None else np.nan for p in rs])
    velo, ivb, hb = f("velo"), f("ivb"), f("hb")
    side, height = f("side"), f("height")
    hand = 1.0 if throws == "Right" else 0.0
    bs = np.array([1.0 if p.get("batterSide") == "Right" else 0.0 if p.get("batterSide") == "Left" else np.nan for p in rs])
    cnt = [str(p.get("count") or "") for p in rs]
    balls = np.array([float(c.split("-")[0]) if "-" in c and c.split("-")[0].isdigit() else np.nan for c in cnt])
    strikes = np.array([float(c.split("-")[1]) if "-" in c and c.split("-")[1].isdigit() else np.nan for c in cnt])
    typ = [FAM.get(p["type"], p["type"]) for p in rs]
    call = [str(p.get("call")).lower().replace(" ", "") for p in rs]
    ev = f("ev")

    def own(x, pre):
        return {f"{pre}velo": velo[x], f"{pre}ivb": ivb[x], f"{pre}hb": hb[x], f"{pre}spin": spin[x], f"{pre}eff": eff[x],
                f"{pre}tilt_sin": np.sin(tilt[x]), f"{pre}tilt_cos": np.cos(tilt[x]),
                f"{pre}rel_h": C["Yc0"][x], f"{pre}rel_s": -C["Zc0"][x], f"{pre}rel_x": C["Xc0"][x]}
    wrap = lambda d: (d + 180) % 360 - 180
    tiltgap = wrap(np.degrees(tilt[j] - tilt[i]))
    df = pd.DataFrame({
        "pitcher": pid, "combo": [f"{typ[a]}>{typ[b]}" for a, b in zip(i, j)],
        **own(j, "b_"), **own(i, "a_"),
        "loc_side": side[j], "loc_height": height[j], "a_loc_side": side[i], "a_loc_height": height[i],
        "loc_dside": side[j] - side[i], "loc_dheight": height[j] - height[i], "balls": balls[j], "strikes": strikes[j], "bat_right": bs[j], "throw_right": hand,
        "sep23": 12 * np.hypot(sD[j] - sD[i], hD[j] - hD[i]), "sepP": 12 * np.hypot(sP[j] - sP[i], hP[j] - hP[i]),
        "rel_angle_gap": np.hypot(vra[j] - vra[i], hra[j] - hra[i]), "app_angle_gap": np.hypot(vaa[j] - vaa[i], haa[j] - haa[i]),
        "tilt_gap": tiltgap, "tilt_gap_abs": np.abs(tiltgap),
        "gyro_gap": gyro[j] - gyro[i], "eff_gap": eff[j] - eff[i], "spin_gap": spin[j] - spin[i],
        "axis_gap": np.degrees(np.arccos(np.clip((axis[:, i] * axis[:, j]).sum(0), -1, 1))),
        "call": [call[x] for x in j], "ev": ev[j],
    })
    return df[np.isfinite(df.sep23) & np.isfinite(df.b_eff) & np.isfinite(df.a_eff)]


BASE = [c for c in ["b_velo", "b_ivb", "b_hb", "b_spin", "b_eff", "b_tilt_sin", "b_tilt_cos", "b_rel_h", "b_rel_s", "b_rel_x",
                    "a_velo", "a_ivb", "a_hb", "a_spin", "a_eff", "a_tilt_sin", "a_tilt_cos", "a_rel_h", "a_rel_s", "a_rel_x",
                    "loc_side", "loc_height", "balls", "strikes", "bat_right", "throw_right"]]
TUNNEL = ["sep23", "sepP", "rel_angle_gap", "app_angle_gap"]
SPIN_PIECES = {"tilt": ["tilt_gap", "tilt_gap_abs"], "gyro": ["gyro_gap"], "efficiency": ["eff_gap"], "spin rate": ["spin_gap"], "axis": ["axis_gap"]}
SPIN = [c for v in SPIN_PIECES.values() for c in v]
LABEL = {"tilt_gap": "tilt gap (B−A, deg)", "tilt_gap_abs": "tilt gap size (deg)", "gyro_gap": "gyro gap (B−A, deg)",
         "eff_gap": "efficiency gap (B−A)", "spin_gap": "spin-rate gap (B−A, rpm)", "axis_gap": "axis gap (deg)"}


def outcomes(D):
    c = D.call
    swing = c.eq("strikeswinging") | c.str.startswith("foulball") | c.eq("inplay")
    inz = (D.loc_side.abs() <= 0.83) & D.loc_height.between(1.5, 3.5)
    takeable = ~c.isin(["hitbypitch", "undefined", "ballintentional"])
    return {
        "chase": (D[~inz & takeable], swing[~inz & takeable].astype(int)),
        "whiff": (D[swing], c[swing].eq("strikeswinging").astype(int)),
        "zone_take": (D[inz & takeable], (~swing)[inz & takeable].astype(int)),
        "ev": (D[c.eq("inplay") & D.ev.notna()], D.ev[c.eq("inplay") & D.ev.notna()]),
    }


def cv(X, y, groups, feats, reg, folds, shap_feats=None):
    import lightgbm as lgb
    params = dict(objective="regression" if reg else "binary", learning_rate=0.07, num_leaves=31, min_data_in_leaf=200,
                  feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=4, seed=7)
    losses, shap_rows = [], []
    for k in range(folds):
        te = groups == k; tr = ~te
        ds = lgb.Dataset(X.loc[tr, feats], y[tr])
        mdl = lgb.train(params, ds, num_boost_round=200)
        p = mdl.predict(X.loc[te, feats])
        yt = y[te]
        if reg: losses.append(float(np.sqrt(np.mean((p - yt) ** 2))))
        else:
            p = np.clip(p, 1e-6, 1 - 1e-6); losses.append(float(-np.mean(yt * np.log(p) + (1 - yt) * np.log(1 - p))))
        if shap_feats:
            contrib = mdl.predict(X.loc[te, feats], pred_contrib=True)
            for f_ in shap_feats:
                shap_rows.append(pd.DataFrame({"f": f_, "x": X.loc[te, f_].to_numpy(), "s": contrib[:, feats.index(f_)]}))
    return np.array(losses), (pd.concat(shap_rows) if shap_rows else None)


def run():
    s3 = sync.r2()
    idx = sync.get_json(s3, "index.json.gz")
    readers = sync.Readers(lambda quiet=False: None)
    p4 = [p for p in idx["pitchers"] if p.get("conf") in sync.P4 and set(p.get("years") or [p.get("year")]) & {2025, 2026}]
    print(f"loading {len(p4)} P4 pitchers…", flush=True)
    frames = readers.map(lambda p: rows_to_pairs(sync.get_json(s3, f"pitchers/{p['id']}.json.gz")["pitches"], p.get("throws"), p["id"]), p4, r2=True)
    D = pd.concat([f for f in frames if f is not None and len(f)], ignore_index=True)
    top = D.combo.value_counts().head(TOP)
    print(f"::notice title=spin study data::{len(D)} back-to-back P4 pairs (2025-2026), {D.pitcher.nunique()} pitchers; "
          f"top combos: " + ", ".join(f"{c} {n}" for c, n in top.items()))
    rng = np.random.default_rng(7)
    pids = D.pitcher.unique(); fold_of = dict(zip(pids, rng.integers(0, 5, len(pids))))
    results = {"generated": pd.Timestamp.now(tz="UTC").isoformat(), "pairs": int(len(D)), "combos": {}}
    for combo in top.index:
        sub = D[D.combo == combo].reset_index(drop=True)
        res = {"n": int(len(sub)), "outcomes": {}}
        lines = []
        for name, (X, y) in outcomes(sub).items():
            reg = name == "ev"
            X = X.reset_index(drop=True); y = y.to_numpy().astype(float)
            if len(X) < 3000: continue
            g = X.pitcher.map(fold_of).to_numpy()
            l0, _ = cv(X, y, g, BASE, reg, 5)
            l1, _ = cv(X, y, g, BASE + TUNNEL, reg, 5)
            l2, sh = cv(X, y, g, BASE + TUNNEL + SPIN, reg, 5, shap_feats=SPIN)
            pct = lambda a, b: float(100 * (a.mean() - b.mean()) / a.mean())
            pieces = {}
            for pname, cols in SPIN_PIECES.items():
                lp, _ = cv(X, y, g, BASE + TUNNEL + cols, reg, 5)
                pieces[pname] = {"lift_pct": round(pct(l1, lp), 3), "folds_better": int((lp < l1).sum())}
            # direction: mean SHAP by fifths of each spin feature, in pct points (binary) or mph
            base_rate = float(y.mean())
            scale = 100 * base_rate * (1 - base_rate) if not reg else 1.0
            shape = {}
            for f_, grp in sh.groupby("f"):
                q = pd.qcut(grp.x, 5, duplicates="drop")
                t = grp.groupby(q, observed=True).agg(x_lo=("x", "min"), x_hi=("x", "max"), s=("s", "mean"))
                shape[f_] = [{"range": [round(float(r.x_lo), 2), round(float(r.x_hi), 2)], "effect": round(float(r.s * scale), 2)} for r in t.itertuples()]
            res["outcomes"][name] = {"n": int(len(X)), "rate": round(base_rate, 4),
                                     "tunnel": {"lift_pct": round(pct(l0, l1), 3), "folds_better": int((l1 < l0).sum())},
                                     "spin": {"lift_pct": round(pct(l1, l2), 3), "folds_better": int((l2 < l1).sum())},
                                     "pieces": pieces, "shape": shape}
            best = max(pieces.items(), key=lambda kv: kv[1]["lift_pct"])
            sp = max(shape.items(), key=lambda kv: max(e["effect"] for e in kv[1]) - min(e["effect"] for e in kv[1]))
            span = lambda e: f"{e[0]['effect']:+.1f}→{e[-1]['effect']:+.1f}"
            lines.append(f"{name} (n={len(X)}): tunnel {pct(l0, l1):+.2f}% [{(l1 < l0).sum()}/5] · spin {pct(l1, l2):+.2f}% [{(l2 < l1).sum()}/5] · "
                         f"best piece {best[0]} {best[1]['lift_pct']:+.2f}% [{best[1]['folds_better']}/5] · biggest swing {LABEL[sp[0]]} low→high {span(sp[1])}{' mph' if reg else ' pts'}")
            print(f"  {combo} {name} done", flush=True)
        results["combos"][combo] = res
        print(f"::notice title=spin study {combo} (n={len(sub)})::" + " | ".join(lines))
    sync.put_json(s3, "studies/spin_study.json.gz", results)
    print("saved studies/spin_study.json.gz")


# ---------- tunnel with location held: both landing spots in the baseline ----------
LOC_BASE = BASE + ["a_loc_side", "a_loc_height", "loc_dside", "loc_dheight", "sepP"]
LOC_TUNNEL = {"apart at 23.8 ft": ["sep23"], "release-angle gap": ["rel_angle_gap"], "approach-angle gap": ["app_angle_gap"]}


def run_tunnel():
    s3 = sync.r2()
    idx = sync.get_json(s3, "index.json.gz")
    readers = sync.Readers(lambda quiet=False: None)
    p4 = [p for p in idx["pitchers"] if p.get("conf") in sync.P4 and set(p.get("years") or [p.get("year")]) & {2025, 2026}]
    frames = readers.map(lambda p: rows_to_pairs(sync.get_json(s3, f"pitchers/{p['id']}.json.gz")["pitches"], p.get("throws"), p["id"]), p4, r2=True)
    D = pd.concat([f for f in frames if f is not None and len(f)], ignore_index=True)
    top = D.combo.value_counts().head(TOP)
    print(f"::notice title=tunnel study data (location held)::{len(D)} back-to-back P4 pairs (2025-2026), {D.pitcher.nunique()} pitchers")
    rng = np.random.default_rng(7)
    pids = D.pitcher.unique(); fold_of = dict(zip(pids, rng.integers(0, 5, len(pids))))
    ALL = [c for v in LOC_TUNNEL.values() for c in v]
    results = {"generated": pd.Timestamp.now(tz="UTC").isoformat(), "pairs": int(len(D)), "combos": {}}
    for combo in top.index:
        sub = D[D.combo == combo].reset_index(drop=True)
        res = {"n": int(len(sub)), "outcomes": {}}
        lines = []
        # how much of the 23.8 ft separation is left once both landing spots are known (R² of sep23 on locations)
        from numpy.linalg import lstsq
        A = np.column_stack([np.ones(len(sub)), sub[["loc_side", "loc_height", "a_loc_side", "a_loc_height"]].to_numpy()])
        A = np.column_stack([A, A[:, 1:] ** 2, sub.loc_dside * sub.loc_dheight])
        okm = np.isfinite(A).all(1) & np.isfinite(sub.sep23)
        coef = lstsq(A[okm], sub.sep23[okm], rcond=None)[0]
        resid = sub.sep23[okm] - A[okm] @ coef
        r2 = 1 - resid.var() / sub.sep23[okm].var()
        for name, (X, y) in outcomes(sub).items():
            reg = name == "ev"
            X = X.reset_index(drop=True); y = y.to_numpy().astype(float)
            if len(X) < 3000: continue
            g = X.pitcher.map(fold_of).to_numpy()
            pct = lambda a, b: float(100 * (a.mean() - b.mean()) / a.mean())
            l0, _ = cv(X, y, g, LOC_BASE, reg, 5)
            l1, sh = cv(X, y, g, LOC_BASE + ALL, reg, 5, shap_feats=["sep23"])
            pieces = {}
            for pname, cols in LOC_TUNNEL.items():
                lp, _ = cv(X, y, g, LOC_BASE + cols, reg, 5)
                pieces[pname] = {"lift_pct": round(pct(l0, lp), 3), "folds_better": int((lp < l0).sum())}
            base_rate = float(y.mean()); scale = 100 * base_rate * (1 - base_rate) if not reg else 1.0
            q = pd.qcut(sh.x, 5, duplicates="drop")
            t = sh.groupby(q, observed=True).agg(x_lo=("x", "min"), x_hi=("x", "max"), s=("s", "mean"))
            shape = [{"range": [round(float(r.x_lo), 1), round(float(r.x_hi), 1)], "effect": round(float(r.s * scale), 2)} for r in t.itertuples()]
            res["outcomes"][name] = {"n": int(len(X)), "rate": round(base_rate, 4),
                                     "tunnel": {"lift_pct": round(pct(l0, l1), 3), "folds_better": int((l1 < l0).sum())}, "pieces": pieces, "sep23_shape": shape}
            pc = " · ".join(f"{k} {v['lift_pct']:+.2f}% [{v['folds_better']}/5]" for k, v in pieces.items())
            sh_txt = " ".join(f"{e['range'][0]:.0f}-{e['range'][1]:.0f}in:{e['effect']:+.1f}" for e in shape)
            lines.append(f"{name} (n={len(X)}): tunnel {pct(l0, l1):+.2f}% [{(l1 < l0).sum()}/5] ({pc}) · 23.8 ft effect by fifths {sh_txt}{' mph' if reg else ' pts'}")
            print(f"  {combo} {name} done", flush=True)
        results["combos"][combo] = res
        print(f"::notice title=tunnel study {combo} (n={len(sub)}; locations explain {r2:.0%} of 23.8 ft separation)::" + " | ".join(lines))
    sync.put_json(s3, "studies/tunnel_location_held.json.gz", results)


if __name__ == "__main__":
    run()
