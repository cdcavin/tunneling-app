"""Turn raw Trackman CSV rows into the app's pitch rows, exactly as the Colab build did
(pipeline/colab/build_pitchers.py + add_outcomes.py). WVU only for now.

Kept in one place so the sync, the dry run and any later rebuild share the same rules:
  id        = PitcherTeam + "__" + slug(Pitcher)        (WVU's team is always WES_MOU)
  names     = "First Last" (the server writes "Last, First"; the app has always shown "First Last")
  season    = "Fall YYYY" for Aug-Dec, else "YYYY"
  type      = home operator tag via TAGMAP; away pitches matched to that pitcher-season's home centroids
  result/ev = Batter's Eye event rules; exit velo on balls in play
"""
import re
import numpy as np
import pandas as pd

WVU = "WES_MOU"
WVU_CODES = {"WES_MOU", "WVN_MN2"}                  # WVN_MN2 = WVU's scrimmage code in 2024-25 (WVU_DUM = guests, left out)
WVU_PARKS = {"WestVirginia", "MonogaliaCounty"}       # Stadium values at WVU's park (name changed in 2025)
TRAJ = [f"PitchTrajectory{a}c{i}" for a in "XYZ" for i in range(3)]
TAGMAP = {"FourSeamFastBall": "Fastball", "Fastball": "Fastball", "TwoSeamFastBall": "Sinker", "Sinker": "Sinker", "Cutter": "Cutter",
          "Slider": "Slider", "Curveball": "Curveball", "ChangeUp": "Changeup", "Splitter": "Splitter", "Sweeper": "Sweeper"}
FEAT = ["RelSpeed", "InducedVertBreak", "HorzBreak"]
NUM = ["RelSpeed", "InducedVertBreak", "HorzBreak", "PlateLocSide", "PlateLocHeight"] + TRAJ

slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
srank = lambda s: int(s[-4:]) * 2 + (1 if s.startswith("Fall") else 0)
txt = lambda v: None if (v is None or (isinstance(v, float) and np.isnan(v)) or str(v) in ("nan", "None", "<NA>", "NaT")) else str(v)
ival = lambda v: int(v) if pd.notna(v) else None
fval = lambda v, d=1: round(float(v), d) if pd.notna(v) else None


def flip_name(n):
    """'Last, First' -> 'First Last' (also 'Last Jr., First' -> 'First Last Jr.'); other names unchanged."""
    n = re.sub(r"\s+", " ", str(n)).strip()
    if "," not in n: return n
    last, first = n.split(",", 1)
    return f"{first.strip()} {last.strip()}".strip()


def event(pc, pr, kb):
    """PA-ending event for one pitch, or None. Same rules as the Colab outcomes cell."""
    pc = str(pc or "").lower().replace(" ", ""); pr = str(pr or "").lower().replace(" ", ""); kb = str(kb or "").lower()
    if pr in ("nan", "none"): pr = ""
    if kb in ("nan", "none"): kb = ""
    if not ((kb in ("strikeout", "walk")) or (pr and pr != "undefined") or "hitbypitch" in pc or pc == "hbp"): return None
    if "hitbypitch" in pc or pc == "hbp": return "HBP"
    if kb == "walk" and "intentional" in pc: return "IBB"
    if kb == "walk": return "BB"
    if kb == "strikeout": return "K"
    return {"single": "Single", "double": "Double", "triple": "Triple", "homerun": "HomeRun",
            "out": "Out", "fielderschoice": "Out", "sacrifice": "Out", "error": "Out"}.get(pr)


def prep_wvu(raw: pd.DataFrame) -> pd.DataFrame:
    """Raw CSV rows (any mix of files) -> WVU pitches with the derived columns, before type matching."""
    wv = raw.rename(columns={"Top/Bottom": "TopBottom"}).reset_index(drop=True)   # unique row labels for the type matching
    wv = wv[wv.PitcherTeam.isin(WVU_CODES) & (wv.Pitcher.fillna("").astype(str).str.strip() != "")].copy()
    wv["home"] = wv.Stadium.isin(WVU_PARKS)
    wv["opponent"] = np.where(wv.HomeTeam.isin(WVU_CODES), wv.AwayTeam, wv.HomeTeam)
    wv["PitcherTeam"] = WVU
    wv["Date"] = pd.to_datetime(wv["Date"], errors="coerce"); wv = wv[wv.Date.notna()].copy()
    yr = wv.Date.dt.year.astype(int).astype(str)
    wv["seasonLabel"] = np.where(wv.Date.dt.month >= 8, "Fall " + yr, yr)
    wv["utc"] = wv["UTCDateTime"].astype(str)
    wv["conf"] = "BIG12"
    wv["type"] = wv.TaggedPitchType.map(TAGMAP)
    wv[NUM] = wv[NUM].apply(pd.to_numeric, errors="coerce")
    wv["Pitcher"] = wv.Pitcher.map(flip_name)
    wv["Batter"] = wv.Batter.map(lambda b: flip_name(b) if pd.notna(b) else b)
    wv["nameKey"] = wv.Pitcher.str.lower()
    wv["id"] = WVU + "__" + wv.Pitcher.map(slug)
    return wv


def match_away_types(wv: pd.DataFrame) -> pd.DataFrame:
    """Away pitches take the nearest home-tagged pitch type for the same pitcher-season (z-distance <= 4).
    Pitcher-seasons with no home pitches are dropped, as in the Colab build."""
    keep = []
    for _, g in wv.groupby(["nameKey", "seasonLabel"]):
        h = g[g["home"] & g.type.notna() & g[FEAT].notna().all(axis=1)]
        if h.empty: continue
        mu, sd = h[FEAT].mean(), h[FEAT].std().replace(0, 1).fillna(1)
        cents = ((h[FEAT] - mu) / sd).groupby(h.type).mean()
        a = g[~g["home"] & g[FEAT].notna().all(axis=1)]
        if not a.empty:
            z = ((a[FEAT] - mu) / sd).to_numpy()
            d = np.linalg.norm(z[:, None, :] - cents.to_numpy()[None, :, :], axis=2)
            wv.loc[a.index, "type"] = np.where(d.min(1) <= 4, cents.index.to_numpy()[d.argmin(1)], None)
        keep.append(g.index)
    wv = wv.loc[np.concatenate(keep)] if keep else wv.iloc[0:0]
    return wv[wv.type.notna()]


def match_types(wv: pd.DataFrame, pool: pd.DataFrame | None = None) -> pd.DataFrame:
    """Same rule as match_away_types, but grouped by pitcher id + season, and the home pitches can also
    come from rows already in the app (`pool`: id, seasonLabel, type, RelSpeed, InducedVertBreak, HorzBreak),
    so a new away outing is typed against everything he's thrown at home that season."""
    keep = []
    pg = {k: g for k, g in pool.groupby(["id", "seasonLabel"])} if pool is not None and len(pool) else {}
    for key, g in wv.groupby(["id", "seasonLabel"]):
        h = g[g["home"] & g.type.notna() & g[FEAT].notna().all(axis=1)][FEAT + ["type"]]
        if key in pg: h = pd.concat([h, pg[key][FEAT + ["type"]]], ignore_index=True)
        if h.empty: continue
        mu, sd = h[FEAT].mean(), h[FEAT].std().replace(0, 1).fillna(1)
        cents = ((h[FEAT] - mu) / sd).groupby(h.type).mean()
        a = g[~g["home"] & g[FEAT].notna().all(axis=1)]
        if not a.empty:
            z = ((a[FEAT] - mu) / sd).to_numpy()
            d = np.linalg.norm(z[:, None, :] - cents.to_numpy()[None, :, :], axis=2)
            wv.loc[a.index, "type"] = np.where(d.min(1) <= 4, cents.index.to_numpy()[d.argmin(1)], None)
        keep.append(g.index)
    wv = wv.loc[np.concatenate(keep)] if keep else wv.iloc[0:0]
    return wv[wv.type.notna()]


def finish(wv: pd.DataFrame) -> pd.DataFrame:
    """Drop incomplete pitches; add count, result, ev; tidy strings."""
    df = wv.dropna(subset=NUM + ["type", "Pitcher"]).copy()
    df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
    df["count"] = pd.to_numeric(df.Balls, errors="coerce").astype("Int64").astype(str) + "-" + \
                  pd.to_numeric(df.Strikes, errors="coerce").astype("Int64").astype(str)
    df["utc"] = df["utc"].where(~df["utc"].astype(str).isin(["None", "nan", "NaT", "<NA>"]), None)
    df["home"] = df["home"].fillna(False).astype(bool)
    df["ev"] = pd.to_numeric(df.ExitSpeed, errors="coerce").where(df.PitchCall.astype(str).str.lower().eq("inplay"))
    df["result"] = [event(a, b, c) for a, b, c in zip(df.PitchCall, df.PlayResult, df.KorBB)]
    return df


def rows(g: pd.DataFrame) -> list[dict]:
    """Pitch rows in the exact shape of the live pitcher files."""
    return [dict(id=r.PitchUID, date=r.Date, game=r.GameID, opponent=txt(r.opponent), season=r.seasonLabel, utc=r.utc, home=bool(r.home),
                 inning=ival(r.Inning), half=txt(r.TopBottom), pa=ival(r.PAofInning), pitchNo=ival(r.PitchofPA),
                 batter=txt(r.Batter), batterSide=txt(r.BatterSide), count=txt(r.count),
                 type=r.type, velo=round(r.RelSpeed, 1), ivb=round(r.InducedVertBreak, 1), hb=round(r.HorzBreak, 1),
                 spin=(round(float(r.SpinRate)) if pd.notna(r.SpinRate) else None), side=round(r.PlateLocSide, 3), height=round(r.PlateLocHeight, 3),
                 call=txt(r.PitchCall), result=txt(r.result), ev=fval(r.ev, 1),
                 coeffs={k[len("PitchTrajectory"):]: round(getattr(r, k), 5) for k in TRAJ},
                 **({"scrimmage": True} if getattr(r, "scrimmage", False) is True else {})) for r in g.itertuples()]
