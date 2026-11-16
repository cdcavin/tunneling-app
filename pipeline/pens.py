"""Bullpens from Trackman practice mode -> R2 (pens/<pitcherId>.json.gz + pens/index.json.gz) for the app's pen toggle.

Practice sessions land on the FTP under /practice/YYYY/MM/DD/Pitching_<local time>_verified.csv: no hitters, no calls,
several pitchers per file. (LiveBpPitching_ and Hitting_ files are left out.) Each WVU pitcher's pitches in a file are one pen.

Pitchers are matched to the app by name, the same id the game sync builds (WES_MOU__first-last); anyone not already in
the app is skipped. Pitch type: the operator tag when there is one, otherwise the nearest of his own game pitch types
(same z-distance rule as away games). Practice files give the 9-parameter fit (x0, vy0, ax0... at y = 50 ft) instead of
Trackman's PitchTrajectory coefficients, so it's re-expanded around release; the axis signs are checked against the
file's own plate location and release height every run and printed.

Intent = his pen fastball velo / his game fastball velo (same pitch type, this year's games).
"""
import io, os, re, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync import r2, get_json, put_json
import rows as R

SINCE = os.environ.get("PENS_SINCE", "2026")
FILE = re.compile(r"^Pitching_(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(_verified)?\.csv$")
FB = ("Fastball", "Sinker")
PLATE_X, RUBBER = 17 / 12, 60.5


def to_coeffs(df):
    """9-parameter fit at y=y0 -> Trackman's c0 + c1 t + c2 t^2 from release, per axis (X distance, Y height, Z = -side)."""
    g = lambda c: df[c].astype(float).to_numpy()
    x0, y0, z0, vx, vy, vz, ax, ay, az = (g(c) for c in ("x0", "y0", "z0", "vx0", "vy0", "vz0", "ax0", "ay0", "az0"))
    yr = RUBBER - df["Extension"].astype(float).to_numpy()
    a, b, c = 0.5 * ay, vy, y0 - yr
    disc = np.sqrt(np.maximum(b * b - 4 * a * c, 0))
    tr = np.where(np.abs(a) > 1e-9, (-b - disc) / (2 * a), -c / b)
    tr = np.where(np.isfinite(tr) & (tr <= 0), tr, (-b + disc) / (2 * a))
    pos = lambda p0, v0, a0: p0 + v0 * tr + 0.5 * a0 * tr * tr
    vel = lambda v0, a0: v0 + a0 * tr
    return {"Xc0": pos(y0, vy, ay), "Xc1": vel(vy, ay), "Xc2": 0.5 * ay,
            "Yc0": pos(z0, vz, az), "Yc1": vel(vz, az), "Yc2": 0.5 * az,
            "Zc0": pos(x0, vx, ax), "Zc1": vel(vx, ax), "Zc2": 0.5 * ax}


def plate(C, i, zsign):
    a, b, c = C["Xc2"][i], C["Xc1"][i], C["Xc0"][i] - PLATE_X
    t = (-b - np.sqrt(max(b * b - 4 * a * c, 0))) / (2 * a) if abs(a) > 1e-9 else -c / b
    if not np.isfinite(t) or t <= 0: t = (-b + np.sqrt(max(b * b - 4 * a * c, 0))) / (2 * a)
    side = -zsign * (C["Zc0"][i] + C["Zc1"][i] * t + C["Zc2"][i] * t * t)
    return side, C["Yc0"][i] + C["Yc1"][i] * t + C["Yc2"][i] * t * t


def run(ftp_factory, upload=True):
    import pandas as pd
    f = ftp_factory(quiet=True)
    s3 = r2()
    index = get_json(s3, "index.json.gz")
    known = {p["id"] for p in index["pitchers"] if p["id"].startswith(R.WVU + "__")}
    files = []
    for y, yd, *_ in f.ls_attr("/practice"):
        if not (yd and y.isdigit() and y >= SINCE[:4]): continue
        for m, md, *_ in f.ls_attr(f"/practice/{y}"):
            if not md: continue
            for d, dd, *_ in f.ls_attr(f"/practice/{y}/{m}"):
                if not dd: continue
                base = f"/practice/{y}/{m}/{d}"
                files += [(f"{base}/{n}", n) for n, isdir, *_ in f.ls_attr(base) if not isdir and FILE.match(n)]
    files = [x for x in files if x[1][9:19].replace("-", "") >= SINCE.replace("-", "")]
    print(f"practice pitching files since {SINCE}: {len(files)}")

    frames, bad = [], 0
    for p, n in sorted(files, key=lambda x: x[1]):
        try: df = pd.read_csv(io.BytesIO(f.read(p)), low_memory=False)
        except Exception: bad += 1; continue
        if df.empty: continue
        m = FILE.match(n)
        df["_session"] = f"PEN-{m.group(1)}{m.group(2)}{m.group(3)}-{m.group(4)}{m.group(5)}{m.group(6)}"
        df["_date"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        frames.append(df)
    if not frames: print("no pens found"); return
    raw = pd.concat(frames, ignore_index=True)
    raw = raw[raw.Pitcher.fillna("").astype(str).str.strip() != ""].copy()
    raw["name"] = raw.Pitcher.map(R.flip_name)
    raw["id"] = R.WVU + "__" + raw.name.map(R.slug)
    print(f"{len(raw)} pen pitches in {raw._session.nunique()} files, {raw.id.nunique()} pitchers, {bad} unreadable")
    raw = raw[raw.id.isin(known)].copy()
    print(f"{len(raw)} pitches from {raw.id.nunique()} pitchers already in the app (others skipped)")
    need = ["x0", "y0", "z0", "vx0", "vy0", "vz0", "ax0", "ay0", "az0", "Extension", "RelSpeed", "InducedVertBreak", "HorzBreak", "PlateLocSide", "PlateLocHeight"]
    for c in need + ["SpinRate", "RelHeight"]: raw[c] = pd.to_numeric(raw.get(c), errors="coerce")
    raw = raw[raw[need].notna().all(axis=1)].reset_index(drop=True)
    C = to_coeffs(raw)

    zsign = None
    for s in (1, -1):
        err = [abs(plate(C, i, s)[0] - raw.PlateLocSide[i]) for i in range(min(len(raw), 400))]
        if np.median(err) < 0.05: zsign = s; break
    if zsign is None:
        print("could not line the 9-parameter fit up with the file's plate location; not uploading"); return
    for k in ("Zc0", "Zc1", "Zc2"): C[k] = C[k] * zsign
    chk = [plate(C, i, 1) for i in range(min(len(raw), 2000))]
    e_side = np.median([abs(a - b) for (a, _), b in zip(chk, raw.PlateLocSide)]) * 12
    e_hgt = np.median([abs(a - b) for (_, a), b in zip(chk, raw.PlateLocHeight)]) * 12
    e_rel = np.nanmedian(np.abs(C["Yc0"] - raw.RelHeight.to_numpy())) * 12 if raw.RelHeight.notna().any() else float("nan")
    print(f"fit check vs the file's own columns (median, inches): plate side {e_side:.2f}, plate height {e_hgt:.2f}, release height {e_rel:.2f}")
    if max(e_side, e_hgt) > 1.0:
        print("fit check failed (> 1 inch); not uploading"); return

    raw["type"] = raw.TaggedPitchType.map(R.TAGMAP)
    out_index, n_up = {}, 0
    for pid, g in raw.groupby("id"):
        doc = get_json(s3, f"pitchers/{pid}.json.gz", missing_ok=True) or {}
        games = [p for p in doc.get("pitches", []) if p.get("type") and p.get("date", "") >= f"{SINCE[:4]}-01-01" and not p.get("scrimmage")]
        if not games: games = [p for p in doc.get("pitches", []) if p.get("type")]
        if games:
            G = pd.DataFrame(games)
            mu = G[["velo", "ivb", "hb"]].mean(); sd = G[["velo", "ivb", "hb"]].std().replace(0, 1).fillna(1)
            cents = ((G[["velo", "ivb", "hb"]] - mu) / sd).groupby(G.type).mean()
            un = g[g.type.isna()]
            if len(un):
                z = ((un[["RelSpeed", "InducedVertBreak", "HorzBreak"]].to_numpy() - mu.to_numpy()) / sd.to_numpy())
                d = np.linalg.norm(z[:, None, :] - cents.to_numpy()[None, :, :], axis=2)
                raw.loc[un.index, "type"] = np.where(d.min(1) <= 4, cents.index.to_numpy()[d.argmin(1)], None)
            fbt = next((t for t in G.type.value_counts().index if t in FB), None)
            game_fb = float(G[G.type == fbt].velo.mean()) if fbt else None
        else:
            fbt, game_fb = None, None
        g = raw.loc[g.index]
        g = g[g.type.notna()]
        if g.empty: continue
        pitches, sessions = [], []
        for sid, s in g.groupby("_session"):
            fbv = s[s.type == fbt].RelSpeed if fbt else s.RelSpeed.iloc[0:0]
            sessions.append({"id": sid, "date": s._date.iloc[0], "time": f"{sid[13:15]}:{sid[15:17]}", "n": int(len(s)),
                             "types": {t: int(v) for t, v in s.type.value_counts().items()},
                             "velo": round(float(s.RelSpeed.mean()), 1), "veloMax": round(float(s.RelSpeed.max()), 1),
                             "fbVelo": round(float(fbv.mean()), 1) if len(fbv) else None,
                             "intent": round(float(fbv.mean()) / game_fb, 3) if len(fbv) and game_fb else None})
            for i, r in s.iterrows():
                pitches.append({"id": str(r.get("PlayID") or f"{sid}-{i}"), "date": r._date, "game": sid, "opponent": "Bullpen",
                                "season": ("Fall " if int(r._date[5:7]) >= 8 else "") + r._date[:4], "home": False, "pen": True,
                                "type": r.type, "velo": round(r.RelSpeed, 1), "ivb": round(r.InducedVertBreak, 1), "hb": round(r.HorzBreak, 1),
                                "spin": round(float(r.SpinRate)) if pd.notna(r.SpinRate) else None,
                                "side": round(r.PlateLocSide, 3), "height": round(r.PlateLocHeight, 3),
                                "coeffs": {k: round(float(C[k][i]), 5) for k in C}})
        sessions.sort(key=lambda x: x["id"])
        out_index[pid] = {"pens": len(sessions), "pitches": len(pitches), "last": sessions[-1]["date"], "fbType": fbt, "gameFbVelo": round(game_fb, 1) if game_fb else None}
        if upload:
            put_json(s3, f"pens/{pid}.json.gz", {"sessions": sessions, "pitches": pitches}); n_up += 1
    print(f"\n{len(out_index)} pitchers with pens · {sum(v['pens'] for v in out_index.values())} pens · {sum(v['pitches'] for v in out_index.values())} pitches")
    for k, (pid, v) in enumerate(sorted(out_index.items(), key=lambda x: -x[1]["pens"])):
        ints = [s["intent"] for s in get_sessions(s3, pid) if s.get("intent")] if upload else []
        print(f"  pitcher {k + 1:2d}: {v['pens']:3d} pens, {v['pitches']:4d} pitches, last {v['last']}, game {v['fbType'] or '-'} {v['gameFbVelo'] or '-'}"
              + (f", intent median {np.median(ints):.0%}" if ints else ""))
    if upload:
        put_json(s3, "pens/index.json.gz", {"since": SINCE, "pitchers": out_index})
        print(f"\nuploaded pens for {n_up} pitchers + pens/index.json.gz")
    else:
        print("\ndry run: nothing uploaded")


def get_sessions(s3, pid):
    d = get_json(s3, f"pens/{pid}.json.gz", missing_ok=True)
    return d["sessions"] if d else []
