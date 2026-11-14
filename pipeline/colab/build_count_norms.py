from google.colab import drive, userdata
drive.mount("/content/drive")
import numpy as np, pandas as pd, pyarrow.parquet as pq, json, gzip, boto3
from botocore.config import Config

KEY, SECRET = userdata.get("R2_KEY"), userdata.get("R2_SECRET")
cols = ["sub_type", "Balls", "Strikes", "PitchCall", "PlateLocSide", "PlateLocHeight", "ExitSpeed", "BatterSide"]
d = pq.read_table("/content/drive/MyDrive/tagged_trackman_v2.parquet", columns=cols).to_pandas()
d["type"] = d["sub_type"].replace({"4-Seam": "Four-Seam"})
d = d[d.type.notna() & d.Balls.between(0, 3) & d.Strikes.between(0, 2)].copy()
d["count"] = d.Balls.astype(int).astype(str) + "-" + d.Strikes.astype(int).astype(str)
c = d.PitchCall.astype(str).str.lower().str.replace(" ", "")
whiff = c.eq("strikeswinging")
inplay = c.eq("inplay")
swing = whiff | c.str.startswith("foulball") | c.eq("foul") | inplay
called = c.eq("strikecalled")
side, height = d.PlateLocSide.astype(float), d.PlateLocHeight.astype(float)
zone = (side.abs() <= 0.83) & height.between(1.5, 3.5)
ev = pd.to_numeric(d.ExitSpeed, errors="coerce")
S = pd.DataFrame({
    "type": d.type, "count": d["count"], "hand": d.BatterSide.astype(str),
    "n": 1, "swings": swing, "whiffs": whiff, "called": called,
    "zone": zone, "ooz": ~zone & side.notna() & height.notna(), "chases": ~zone & swing & side.notna(),
    "evN": inplay & ev.notna(), "hard": inplay & (ev >= 95),
})
STATS = ["n", "swings", "whiffs", "called", "zone", "ooz", "chases", "evN", "hard"]

def pool(sub):
    out = {}
    for (t, k), g in sub.groupby(["type", "count"]):
        out.setdefault(k, {})[t] = {s: int(g[s].sum()) for s in STATS}
    return out

norms = {"generated": pd.Timestamp.utcnow().strftime("%Y-%m-%d"), "pitches": int(len(S)),
         "hands": {"all": pool(S), "Left": pool(S[S.hand == "Left"]), "Right": pool(S[S.hand == "Right"])}}
buf = gzip.compress(json.dumps(norms, separators=(",", ":")).encode())
s3 = boto3.client("s3", endpoint_url="https://7e54275932eb85e9ef346c9e2d731750.r2.cloudflarestorage.com",
                  aws_access_key_id=KEY, aws_secret_access_key=SECRET, region_name="auto", config=Config(retries={"max_attempts": 8}))
s3.put_object(Bucket="tunneling-data", Key="count_norms.json.gz", Body=buf, ContentType="application/json", ContentEncoding="gzip")
print(f"{len(S):,} D1 pitches · {len(norms['hands']['all'])} counts · {len(buf)/1e3:.0f} KB uploaded as count_norms.json.gz")
print(S.groupby("count").n.sum().reindex(["0-0","1-0","0-1","2-0","1-1","0-2","3-0","2-1","1-2","3-1","2-2","3-2"]).to_string())
