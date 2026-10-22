# Runs after build_pitchers.py in the same runtime (needs df).
from google.colab import userdata
KEY, SECRET = userdata.get("R2_KEY"), userdata.get("R2_SECRET")
import pyarrow.parquet as pq, pandas as pd, numpy as np, json, gzip, os, shutil, boto3, concurrent.futures as cf
from botocore.config import Config

OC = ["PitchUID","PlayResult","KorBB","ExitSpeed","Angle"]
d1o = pq.read_table("/content/drive/MyDrive/tagged_trackman_v2.parquet", columns=OC).to_pandas()
wf = "/content/drive/MyDrive/WVU/Data/wvu_tm_pbp.parquet"
wvo = pq.read_table(wf, columns=[c for c in OC if c in pq.read_schema(wf).names]).to_pandas()
oc = pd.concat([d1o, wvo], ignore_index=True).drop_duplicates("PitchUID", keep="last")
df2 = df.drop(columns=[c for c in OC[1:] if c in df.columns]).merge(oc, on="PitchUID", how="left")

# Batter's Eye event rules (no weights are used in the app; only the event).
def event(pc, pr, kb):
    pc = str(pc or "").lower().replace(" ", ""); pr = str(pr or "").lower().replace(" ", ""); kb = str(kb or "").lower()
    if pr in ("nan", "none"): pr = ""
    if kb in ("nan", "none"): kb = ""
    if not ((kb in ("strikeout", "walk")) or (pr and pr != "undefined") or "hitbypitch" in pc or pc == "hbp"): return None
    if "hitbypitch" in pc or pc == "hbp": return "HBP"
    if kb == "walk" and "intentional" in pc: return "IBB"
    if kb == "walk": return "BB"
    if kb == "strikeout": return "K"
    return {"single":"Single","double":"Double","triple":"Triple","homerun":"HomeRun",
            "out":"Out","fielderschoice":"Out","sacrifice":"Out","error":"Out"}.get(pr)
df2["ev"] = pd.to_numeric(df2.ExitSpeed, errors="coerce").where(df2.PitchCall.astype(str).str.lower().eq("inplay"))
df2["result"] = [event(a, b, c) for a, b, c in zip(df2.PitchCall, df2.PlayResult, df2.KorBB)]

# Pitcher files rewritten with rows() from build_pitchers.py plus:  result=txt(r.result), ev=fval(r.ev, 1)
# (placed after call=..., before coeffs=...), and throws = mode of PitcherThrows. Index unchanged.
