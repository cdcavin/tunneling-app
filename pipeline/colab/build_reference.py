# Runs after add_outcomes.py in the same runtime (needs df2). Writes reference.json.gz to R2.
from google.colab import userdata
KEY, SECRET = userdata.get("R2_KEY"), userdata.get("R2_SECRET")
import numpy as np, pandas as pd, json, gzip, boto3
from botocore.config import Config

PLATE_X = 17/12; DEC_X = 23.8 + PLATE_X
FAM = {"Fastball": "Four-Seam", "Sweeper": "Slider"}           # WVU tags -> classifier names
d = df2[df2.conf.isin(["ACC","BIG10","BIG12","SEC"])].copy()
d["t2"] = d["type"].replace(FAM)
C = {k: d[f"PitchTrajectory{k}"].to_numpy(float) for k in ["Xc0","Xc1","Xc2","Yc0","Yc1","Yc2","Zc0","Zc1","Zc2"]}
def pos_at(dist):                                               # same root choice as the app's timeAtDist
    a, b, k = C["Xc2"], C["Xc1"], C["Xc0"] - dist
    disc = np.sqrt(np.clip(b*b - 4*a*k, 0, None))
    t1, t2 = (-b - disc) / (2*a), (-b + disc) / (2*a)
    lo, hi = np.minimum(t1, t2), np.maximum(t1, t2)
    t = np.where(lo >= -1e-9, np.maximum(lo, 0), np.maximum(hi, 0))
    return C["Yc0"] + C["Yc1"]*t + C["Yc2"]*t*t, -(C["Zc0"] + C["Zc1"]*t + C["Zc2"]*t*t)
d["hD"], d["sD"] = pos_at(DEC_X); d["hP"], d["sP"] = pos_at(PLATE_X)

d = d.sort_values(["GameID","Inning","TopBottom","PAofInning","PitchofPA"]).reset_index(drop=True)
nx = d.shift(-1)
ok = ((nx.GameID == d.GameID) & (nx.Inning == d.Inning) & (nx.TopBottom == d.TopBottom) & (nx.PAofInning == d.PAofInning)
      & (nx.PitchofPA - d.PitchofPA == 1) & (nx["id"] == d["id"]))
P = pd.DataFrame({
    "conf": d.conf, "combo": d.t2 + ">" + nx.t2,
    "sep23": 12*np.hypot(nx.sD - d.sD, nx.hD - d.hD), "sepP": 12*np.hypot(nx.sP - d.sP, nx.hP - d.hP),
    "call": nx.PitchCall.astype(str).str.lower().str.replace(" ", ""), "result": nx.result, "ev": pd.to_numeric(nx.ev, errors="coerce"),
    "side": nx.PlateLocSide.astype(float), "height": nx.PlateLocHeight.astype(float),
})[ok.fillna(False)]
P = P[np.isfinite(P.sep23) & (P.sepP >= 6)]

swing = P.call.eq("strikeswinging") | P.call.str.startswith("foulball") | P.call.eq("inplay")
ooz = ~((P.side.abs() <= 0.83) & P.height.between(1.5, 3.5))
r = P.result.fillna("")
TBm = {"Single":1,"Double":2,"Triple":3,"HomeRun":4}
P = P.assign(
    swings=swing, whiffs=P.call.eq("strikeswinging"), contacts=swing & ~P.call.eq("strikeswinging"),
    outOfZone=ooz, chases=ooz & swing, takes=~swing, calledStrikes=P.call.eq("strikecalled"),
    evN=P.call.eq("inplay") & P.ev.notna(), evSum=np.where(P.call.eq("inplay"), P.ev.fillna(0), 0.0),
    hard=P.call.eq("inplay") & (P.ev >= 95),
    pa=r.ne("") & r.ne("IBB"), bb=r.eq("BB"), hbp=r.eq("HBP"), k=r.eq("K"),
    hits=r.isin(list(TBm)), tb=r.map(TBm).fillna(0),
)
P["ab"] = P.pa & ~P.bb & ~P.hbp
P["bin"] = np.minimum(np.floor(P.sep23), 20).astype(int)        # 1-in bins, 20 = 20+
STATS = ["swings","whiffs","contacts","outOfZone","chases","takes","calledStrikes","evN","evSum","hard","pa","ab","hits","tb","k","bb","hbp"]

def build(sub):                                                 # final version: no minimum pair count per combo
    out = {}
    for combo, g in sub.groupby("combo"):
        agg = g.groupby("bin")[STATS].sum().astype(float)
        agg["n"] = g.groupby("bin").size()
        out[combo] = {"n": int(len(g)),
                      "pct": [round(float(x), 2) for x in np.percentile(g.sep23, np.arange(5, 100, 5))],
                      "bins": {int(b): {k: round(float(v), 1) for k, v in row.items()} for b, row in agg.iterrows()}}
    return out
ref = {"generated": pd.Timestamp.utcnow().strftime("%Y-%m-%d"), "minPlateIn": 6, "decisionFt": 23.8,
       "pools": {"P4": build(P), "BIG12": build(P[P.conf == "BIG12"])}}
buf = gzip.compress(json.dumps(ref, separators=(",",":")).encode())
s3 = boto3.client("s3", endpoint_url="https://7e54275932eb85e9ef346c9e2d731750.r2.cloudflarestorage.com",
                  aws_access_key_id=KEY, aws_secret_access_key=SECRET, region_name="auto", config=Config(retries={"max_attempts": 8}))
s3.put_object(Bucket="tunneling-data", Key="reference.json.gz", Body=buf, ContentType="application/json", ContentEncoding="gzip")
