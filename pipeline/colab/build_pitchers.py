from google.colab import drive
drive.mount("/content/drive")
!pip -q install boto3
import pyarrow.parquet as pq, pandas as pd, numpy as np, json, gzip, os, re, shutil, boto3, concurrent.futures as cf
from collections import Counter
from botocore.config import Config
from google.colab import userdata

OUT = "/content/tunnel/out2"; shutil.rmtree(OUT, ignore_errors=True); os.makedirs(f"{OUT}/pitchers")
TRAJ = [f"PitchTrajectory{a}c{i}" for a in "XYZ" for i in range(3)]
BASE = ["PitchUID","Date","GameID","PitcherId","Pitcher","PitcherThrows","PitcherTeam","HomeTeam","AwayTeam","Stadium","League",
        "Inning","TopBottom","PAofInning","PitchofPA","Batter","BatterSide","Balls","Strikes","PitchCall",
        "RelSpeed","InducedVertBreak","HorzBreak","SpinRate","PlateLocSide","PlateLocHeight"] + TRAJ
WVU_CODES = {"WES_MOU", "WES_VIR4"}
WV_NAMES  = {"West Virginia", "WVN_MN2"}

# ── D1 ──
d1 = pq.read_table("/content/drive/MyDrive/tagged_trackman_v2.parquet", columns=BASE + ["season","sub_type"]).to_pandas()
d1 = d1[~d1.PitcherTeam.isin(WVU_CODES)].copy()
d1["type"] = d1["sub_type"].replace({"4-Seam": "Four-Seam"})
d1["seasonLabel"] = d1["season"].astype(int).astype(str)
d1["utc"] = None
d1["home"] = (d1.HomeTeam == d1.PitcherTeam)
d1["opponent"] = np.where(d1["home"], d1.AwayTeam, d1.HomeTeam)
home = d1[d1["home"]].groupby("PitcherTeam")["League"].agg(lambda s: Counter(s).most_common(1)[0][0])
conf = home.to_dict()
conf.update({"MIN_GOP":"BIG10","PIT_UNI":"ACC","GEO_HOY":"BIGEAST","HOL_CRU":"PAT","DAV_UNI":"A10","SEA_UNI":"WAC",
             "STB_BON":"A10","FDU_KNI":"NEC","WAG_SEA":"NEC","NJI_HIG":"AMEAST","MAI_BLA":"AMEAST","UNI_BRI":"NEC",
             "SIE_SAI":"MAAC","ION_GAE":"MAAC","MER_COL1":"NEC","SAC_PIO":"NEC","BGS_FAL":"MAC","TEX_TIG":"SWAC",
             "ARK_LIO":"SWAC","PRA_PAN":"SWAC","JAC_TIG":"SWAC","MIS_DEL":"SWAC","COP_STA":"MEAC","NCA_BUL":"MEAC",
             "SOU_JAG":"SWAC","ALC_BRA":"SWAC","BAL_UNI":"MAC","UTM_SKY":"OVC","XAV_LOU":"SLAND"})
d1["conf"] = d1.PitcherTeam.map(conf).fillna("Unknown")

# ── WVU ──
wf = "/content/drive/MyDrive/WVU/Data/wvu_tm_pbp.parquet"
wv_cols = pq.read_schema(wf).names
wv = pq.read_table(wf, columns=[c for c in BASE + ["UTCDateTime","TaggedPitchType"] if c in wv_cols]).to_pandas()
wv = wv[wv.PitcherTeam.isin(WV_NAMES) & (wv.Pitcher.fillna("") != "")].copy()
wv["home"] = (wv.Stadium == "WestVirginia")
wv["opponent"] = np.where(wv.HomeTeam.isin(WV_NAMES), wv.AwayTeam, wv.HomeTeam)
wv["PitcherTeam"] = "WES_MOU"
wv["Date"] = pd.to_datetime(wv["Date"], errors="coerce"); wv = wv[wv.Date.notna()].copy()
yr = wv.Date.dt.year.astype(int).astype(str)
wv["seasonLabel"] = np.where(wv.Date.dt.month >= 8, "Fall " + yr, yr)
wv["utc"] = wv["UTCDateTime"].astype(str) if "UTCDateTime" in wv_cols else None
wv["conf"] = "BIG12"; wv["League"] = "BIG12"
TAGMAP = {"FourSeamFastBall":"Four-Seam","Fastball":"Fastball","TwoSeamFastBall":"Sinker","Sinker":"Sinker","Cutter":"Cutter",
          "Slider":"Slider","Curveball":"Curveball","ChangeUp":"Changeup","Splitter":"Splitter","Sweeper":"Sweeper"}
wv["type"] = wv.TaggedPitchType.map(TAGMAP)
feat = ["RelSpeed","InducedVertBreak","HorzBreak"]
wv[feat] = wv[feat].apply(pd.to_numeric, errors="coerce")
wv["nameKey"] = wv.Pitcher.str.strip().str.replace(r"\s+", " ", regex=True).str.lower()
keep = []
for (nk, lab), g in wv.groupby(["nameKey","seasonLabel"]):          # by name, so his two Trackman IDs share one arsenal
    h = g[g["home"] & g.type.notna() & g[feat].notna().all(axis=1)]
    if h.empty: continue
    mu, sd = h[feat].mean(), h[feat].std().replace(0, 1).fillna(1)
    cents = ((h[feat] - mu) / sd).groupby(h.type).mean()
    a = g[~g["home"] & g[feat].notna().all(axis=1)]
    if not a.empty:
        z = ((a[feat] - mu) / sd).to_numpy()
        d = np.linalg.norm(z[:, None, :] - cents.to_numpy()[None, :, :], axis=2)
        wv.loc[a.index, "type"] = np.where(d.min(1) <= 4, cents.index.to_numpy()[d.argmin(1)], None)
    keep.append(g.index)
wv = wv.loc[np.concatenate(keep)] if keep else wv.iloc[0:0]
wv = wv[wv.type.notna()]

# ── Combine; one key per pitcher = name + team ──
df = pd.concat([d1, wv.drop(columns=["nameKey"])], ignore_index=True)
df["Date"] = pd.to_datetime(df["Date"], errors="coerce"); df = df[df.Date.notna()]
df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
num = ["RelSpeed","InducedVertBreak","HorzBreak","PlateLocSide","PlateLocHeight"] + TRAJ
df[num] = df[num].apply(pd.to_numeric, errors="coerce")
df = df.dropna(subset=num + ["type","Pitcher"])
df["Pitcher"] = df.Pitcher.astype(str).str.strip().str.replace(r"\s+", " ", regex=True)
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
df["id"] = df.PitcherTeam.astype(str) + "__" + df.Pitcher.map(slug)
df["count"] = df.Balls.astype("Int64").astype(str) + "-" + df.Strikes.astype("Int64").astype(str)
df["utc"] = df["utc"].where(~df["utc"].astype(str).isin(["None","nan","NaT","<NA>"]), None)
df["home"] = df["home"].fillna(False).astype(bool)
srank = lambda s: int(s[-4:]) * 2 + (1 if s.startswith("Fall") else 0)
txt = lambda v: None if (v is None or (isinstance(v, float) and np.isnan(v)) or str(v) in ("nan","None","<NA>")) else str(v)
ival = lambda v: int(v) if pd.notna(v) else None

def rows(g):
    return [dict(id=r.PitchUID, date=r.Date, game=r.GameID, opponent=txt(r.opponent), season=r.seasonLabel, utc=r.utc, home=bool(r.home),
                 inning=ival(r.Inning), half=txt(r.TopBottom), pa=ival(r.PAofInning), pitchNo=ival(r.PitchofPA),
                 batter=txt(r.Batter), batterSide=txt(r.BatterSide), count=txt(r.count),
                 type=r.type, velo=round(r.RelSpeed,1), ivb=round(r.InducedVertBreak,1), hb=round(r.HorzBreak,1),
                 spin=(round(float(r.SpinRate)) if pd.notna(r.SpinRate) else None), side=round(r.PlateLocSide,3), height=round(r.PlateLocHeight,3),
                 call=txt(r.PitchCall), coeffs={k[len("PitchTrajectory"):]: round(getattr(r,k),5) for k in TRAJ}) for r in g.itertuples()]

index = []
for pid, g in df.groupby("id", sort=False):
    f = g.iloc[0]
    seasons = sorted(g.seasonLabel.unique(), key=srank, reverse=True)
    games = g.groupby("GameID").Date.min()
    throws = Counter(g.PitcherThrows.dropna()).most_common(1)[0][0] if g.PitcherThrows.notna().any() else "Right"
    index.append(dict(id=pid, name=f.Pitcher, throws=throws, team=f.PitcherTeam, conf=f.conf, season=seasons[0], seasons=seasons,
                      years=sorted({int(s[-4:]) for s in seasons}, reverse=True), year=int(seasons[0][-4:]), fall=seasons[0].startswith("Fall"),
                      n=int(len(g)), first=games.min(), last=games.max(), games=int(len(games))))
    doc = dict(id=pid, name=f.Pitcher, throws=throws, team=f.PitcherTeam, conf=f.conf, season=seasons[0], pitches=rows(g))
    with gzip.open(f"{OUT}/pitchers/{pid}.json.gz", "wt") as fh: json.dump(doc, fh, separators=(",",":"))
idx = dict(generated=pd.Timestamp.utcnow().strftime("%Y-%m-%d"), dataThrough=df.Date.max(), sample=False,
           teams=sorted(df.PitcherTeam.unique().tolist()), confs=sorted(df.conf.unique().tolist()), pitchers=index)
with gzip.open(f"{OUT}/index.json.gz", "wt") as fh: json.dump(idx, fh, separators=(",",":"))
w = [p for p in index if p["team"] == "WES_MOU"]
print(f"wrote {len(index)} pitchers ({len(w)} WVU); index {os.path.getsize(f'{OUT}/index.json.gz')/1e6:.2f} MB")
# (upload: see the boto3 upload cell; index swapped last, old per-season files removed)
