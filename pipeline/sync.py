"""WVU sync: Trackman FTP -> the app's pitcher files, index and P4 reference in R2.

    run(open_ftp, upload=False)   dry run: does everything except the uploads, and prints what would change
    run(open_ftp, upload=True)    the real thing

What a run does
  1. Lists every game file under /v3 and compares with the list saved from the last run (sync/state.json.gz in R2).
     First run: every file from 2025 on is a candidate. Later runs: only files that are new or changed.
  2. Picks the files with WVU in them: WVU-park games and scrimmages by file name (not BP), and any other
     park's game where WVU is the home or away team (checked from the first rows of the file).
     One copy per game: the verified copy when there is one; an unverified copy never replaces a verified one.
  3. Builds WVU pitch rows with the Colab rules (pipeline/rows.py), names as "First Last", opponent as a
     readable name, away pitches typed against his home pitches that season (new and already in the app).
  4. Merges into each pitcher's file by PitchUID (new rows replace old; nothing is deleted).
     Files written before the sync (no "v": 2) are WVU rows from the Colab build: plate location is in inches
     there and some release times are epoch seconds, so the rows the server doesn't replace are converted.
  5. Rebuilds the WVU entries in index.json and the P4 / Big 12 reference from every P4 pitcher file.
  6. Backs up what it's about to replace (backup/<time>/), then uploads changed pitcher files, the reference,
     the index (last, so the app never points at a missing file) and the state.
"""
import csv, gzip, io, json, os, re, sys
import concurrent.futures as cf
import datetime as dt
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

import rows as R

BUCKET = "tunneling-data"
SINCE = "20250101"
SKIP = re.compile(r"_(playerpositioning|battracking|playertracking|playevents)", re.I)
WVU_PARK_FILE = re.compile(r"^\d{8}-(WestVirginia|MonogaliaCounty)(-Private)?-\d+(_unverified)?\.csv$")
P4 = {"ACC", "BIG10", "BIG12", "SEC"}
EPOCH = re.compile(r"^\d{9,11}(\.\d+)?$")
NAMES_FIXED = {"WES_MOU": "West Virginia", "WVN_MN2": "West Virginia"}


# ---------- R2 ----------
def r2():
    k, sec = os.environ.get("R2_KEY", "").strip(), os.environ.get("R2_SECRET", "").strip()
    if not (k and sec): sys.exit("R2_KEY / R2_SECRET are not set.")
    for v in (k, sec): print(f"::add-mask::{v}")
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url="https://7e54275932eb85e9ef346c9e2d731750.r2.cloudflarestorage.com",
                        aws_access_key_id=k, aws_secret_access_key=sec, region_name="auto",
                        config=Config(max_pool_connections=32, retries={"max_attempts": 8, "mode": "adaptive"}))


def get_json(s3, key, missing_ok=False):
    try:
        body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
    except Exception as e:
        code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if missing_ok and code in ("NoSuchKey", "404"): return None
        if code in ("SignatureDoesNotMatch", "InvalidAccessKeyId"):
            sys.exit(f"R2 refused the keys ({code}). Re-paste R2_KEY / R2_SECRET in the GitHub secrets.")
        raise
    try: body = gzip.decompress(body)
    except OSError: pass
    return json.loads(body)


def put_json(s3, key, obj):
    s3.put_object(Bucket=BUCKET, Key=key, Body=gzip.compress(json.dumps(obj, separators=(",", ":")).encode()),
                  ContentType="application/json", ContentEncoding="gzip")


# ---------- FTP ----------
def walk(f):
    """Every file under /v3/YYYY/MM/DD/CSV: (path, name, size, mtime)."""
    out = []
    for y, yd, *_ in f.ls_attr("/v3"):
        if not (yd and y.isdigit()): continue
        for m, md, *_ in f.ls_attr(f"/v3/{y}"):
            if not md: continue
            for d, dd, *_ in f.ls_attr(f"/v3/{y}/{m}"):
                if not dd: continue
                base = f"/v3/{y}/{m}/{d}/CSV"
                try: items = f.ls_attr(base)
                except Exception: continue
                out += [(f"{base}/{n}", n, sz, mt) for n, isdir, sz, mt in items if not isdir]
    return out


class Readers:
    """A few SFTP connections in parallel (one per thread) so thousands of files read in minutes."""
    def __init__(self, open_ftp, n=6):
        import threading
        self.open_ftp, self.local = open_ftp, threading.local()
        self.ftp_pool, self.io_pool = cf.ThreadPoolExecutor(n), cf.ThreadPoolExecutor(24)   # SFTP reads / R2 reads and writes

    def _c(self):
        if not hasattr(self.local, "f"): self.local.f = self.open_ftp(quiet=True)
        return self.local.f

    def head(self, path, nbytes=16384):
        with self._c().c.open(path, "rb") as fh: return fh.read(nbytes)

    def full(self, path):
        with self._c().c.open(path, "rb") as fh:
            fh.prefetch(); return fh.read()

    def map(self, fn, items, r2=False):
        return list((self.io_pool if r2 else self.ftp_pool).map(fn, items))


def game_key(n): return n.replace("_unverified", "")
def verified(n): return "_unverified" not in n


def teams_in(head: bytes):
    """Home/away team codes from the first rows of a CSV (empty set if the file has no rows)."""
    lines = head.decode("utf-8", "ignore").splitlines()[:6]
    if len(lines) < 2: return set()
    rd = list(csv.reader(lines))
    hdr = rd[0]
    out = set()
    for row in rd[1:]:
        if len(row) < len(hdr) - 1: continue      # last line may be cut off
        rec = dict(zip(hdr, row))
        out |= {rec.get("HomeTeam", ""), rec.get("AwayTeam", "")}
    return out - {""}


# ---------- legacy (Colab-built WVU rows) ----------
def legacy_fix(r):
    """Colab WVU rows: plate location in inches -> feet, epoch release time -> ISO, Four-Seam -> Fastball."""
    r = dict(r)
    if r.get("side") is not None: r["side"] = round(r["side"] / 12, 3)
    if r.get("height") is not None: r["height"] = round(r["height"] / 12, 3)
    u = r.get("utc")
    if u and EPOCH.match(str(u)):
        r["utc"] = dt.datetime.fromtimestamp(float(u), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    if r.get("type") == "Four-Seam": r["type"] = "Fastball"
    return r


# ---------- reference (same math as pipeline/colab/build_reference.py) ----------
PLATE_X = 17 / 12; DEC_X = 23.8 + PLATE_X
FAM = {"Fastball": "Four-Seam", "Sweeper": "Slider"}
STATS = ["swings", "whiffs", "contacts", "outOfZone", "chases", "takes", "calledStrikes", "evN", "evSum", "hard",
         "pa", "ab", "hits", "tb", "k", "bb", "hbp"]
TBm = {"Single": 1, "Double": 2, "Triple": 3, "HomeRun": 4}


def pairs_of(pitches):
    """Back-to-back pairs from one pitcher's rows -> DataFrame with combo, sep23 and the second pitch's stats."""
    rs = [p for p in pitches if p.get("coeffs") and None not in (p.get("game"), p.get("inning"), p.get("half"), p.get("pa"), p.get("pitchNo"))]
    if len(rs) < 2: return None
    rs.sort(key=lambda p: (str(p["game"]), p["inning"], str(p["half"]), p["pa"], p["pitchNo"]))
    C = {k: np.array([float(p["coeffs"].get(k, np.nan)) for p in rs]) for k in ["Xc0", "Xc1", "Xc2", "Yc0", "Yc1", "Yc2", "Zc0", "Zc1", "Zc2"]}

    def pos_at(dist):
        a, b, k = C["Xc2"], C["Xc1"], C["Xc0"] - dist
        with np.errstate(invalid="ignore", divide="ignore"):
            disc = np.sqrt(np.clip(b * b - 4 * a * k, 0, None))
            t1, t2 = (-b - disc) / (2 * a), (-b + disc) / (2 * a)
        lo, hi = np.minimum(t1, t2), np.maximum(t1, t2)
        t = np.where(lo >= -1e-9, np.maximum(lo, 0), np.maximum(hi, 0))
        return C["Yc0"] + C["Yc1"] * t + C["Yc2"] * t * t, -(C["Zc0"] + C["Zc1"] * t + C["Zc2"] * t * t)

    hD, sD = pos_at(DEC_X); hP, sP = pos_at(PLATE_X)
    key = [(str(p["game"]), p["inning"], str(p["half"]), p["pa"]) for p in rs]
    pn = np.array([p["pitchNo"] for p in rs])
    ok = np.array([key[i] == key[i + 1] for i in range(len(rs) - 1)]) & (np.diff(pn) == 1)
    i = np.nonzero(ok)[0]; j = i + 1
    if not len(i): return None
    t2 = [FAM.get(p["type"], p["type"]) for p in rs]
    nx = [rs[x] for x in j]
    P = pd.DataFrame({
        "combo": [f"{t2[a]}>{t2[b]}" for a, b in zip(i, j)],
        "sep23": 12 * np.hypot(sD[j] - sD[i], hD[j] - hD[i]), "sepP": 12 * np.hypot(sP[j] - sP[i], hP[j] - hP[i]),
        "call": [str(p.get("call")).lower().replace(" ", "") for p in nx], "result": [p.get("result") or "" for p in nx],
        "ev": pd.to_numeric(pd.Series([p.get("ev") for p in nx]), errors="coerce").to_numpy(),
        "side": [float(p["side"]) for p in nx], "height": [float(p["height"]) for p in nx],
    })
    return P[np.isfinite(P.sep23) & (P.sepP >= 6)]


def reference_from(pair_frames):
    """pair_frames: [(conf, DataFrame)] -> reference.json structure."""
    parts = [df.assign(conf=c) for c, df in pair_frames if df is not None and len(df)]
    if not parts: return None
    P = pd.concat(parts, ignore_index=True)
    swing = P.call.eq("strikeswinging") | P.call.str.startswith("foulball") | P.call.eq("inplay")
    ooz = ~((P.side.abs() <= 0.83) & P.height.between(1.5, 3.5))
    r = P.result.fillna("")
    inplay = P.call.eq("inplay")
    P = P.assign(
        swings=swing, whiffs=P.call.eq("strikeswinging"), contacts=swing & ~P.call.eq("strikeswinging"),
        outOfZone=ooz, chases=ooz & swing, takes=~swing, calledStrikes=P.call.eq("strikecalled"),
        evN=inplay & P.ev.notna(), evSum=np.where(inplay, P.ev.fillna(0), 0.0), hard=inplay & (P.ev >= 95),
        pa=r.ne("") & r.ne("IBB"), bb=r.eq("BB"), hbp=r.eq("HBP"), k=r.eq("K"), hits=r.isin(list(TBm)), tb=r.map(TBm).fillna(0),
    )
    P["ab"] = P.pa & ~P.bb & ~P.hbp
    P["bin"] = np.minimum(np.floor(P.sep23), 20).astype(int)

    def build(sub):
        out = {}
        for combo, g in sub.groupby("combo"):
            agg = g.groupby("bin")[STATS].sum().astype(float)
            agg["n"] = g.groupby("bin").size()
            out[combo] = {"n": int(len(g)),
                          "pct": [round(float(x), 2) for x in np.percentile(g.sep23, np.arange(5, 100, 5))],
                          "bins": {int(b): {k: round(float(v), 1) for k, v in row.items()} for b, row in agg.iterrows()}}
        return out
    return {"generated": dt.date.today().isoformat(), "minPlateIn": 6, "decisionFt": 23.8,
            "pools": {"P4": build(P), "BIG12": build(P[P.conf == "BIG12"])}}


# ---------- the run ----------
def run(open_ftp, upload=False):
    s3 = r2()
    f = open_ftp()
    idx = get_json(s3, "index.json.gz")
    state = get_json(s3, "sync/state.json.gz", missing_ok=True) or {}
    first = not state.get("seen")
    seen = state.get("seen", {})
    done_games = state.get("games", {})                  # game key -> 1 verified / 0 unverified, last copy used
    team_names = dict(state.get("teamNames", {}))
    print(f"{'FIRST RUN (full WVU rebuild from 2025 on)' if first else 'incremental run'} | upload={'yes' if upload else 'NO (dry run)'}")

    # 1. what's on the server, and what's new
    files = walk(f)
    csvs = [x for x in files if x[1].lower().endswith(".csv") and not SKIP.search(x[1]) and x[1][:8] >= SINCE]
    fresh = [x for x in csvs if first or seen.get(x[0]) != [x[2], x[3]]]
    print(f"server: {len(files)} files, {len(csvs)} game CSVs from 2025 on, {len(fresh)} new or changed since last run")

    # 2. which of them have WVU in them (one copy per game: verified beats unverified)
    by_game = defaultdict(list)
    for x in fresh: by_game[game_key(x[1])].append(x)
    chosen = {}
    for k, xs in by_game.items():
        xs.sort(key=lambda x: (verified(x[1]), x[0]))
        best = xs[-1]
        if not verified(best[1]) and done_games.get(k) == 1: continue      # never replace a verified copy
        chosen[k] = best
    readers = Readers(open_ftp)
    park = [x for x in chosen.values() if WVU_PARK_FILE.match(x[1])]
    other = [x for x in chosen.values() if not WVU_PARK_FILE.match(x[1]) and not re.search(r"-BP-|WVU_DUM", x[1])]
    heads = readers.map(lambda x: (x, teams_in(readers.head(x[0]))), other)
    away = [x for x, t in heads if t & R.WVU_CODES]
    use = park + away
    print(f"WVU files to read: {len(park)} at WVU's park, {len(away)} elsewhere (checked {len(other)} other games' headers)")

    frames = []
    def load(x):
        try:
            df = pd.read_csv(io.BytesIO(readers.full(x[0])), low_memory=False)
            return x, df
        except Exception as e:
            return x, e
    bad = []
    for x, df in readers.map(load, use):
        if isinstance(df, Exception): bad.append((x[1], type(df).__name__)); continue
        if df.empty: continue
        df["_file"] = x[1]; frames.append(df)
    if bad: print("unreadable files:", bad[:10])
    raw = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    # 3. current WVU pitcher files
    live = {p["id"]: p for p in idx["pitchers"] if p.get("team") == R.WVU}
    docs = dict(zip(live, readers.map(lambda pid: get_json(s3, f"pitchers/{pid}.json.gz"), list(live), r2=True)))
    uid_owner = {str(r["id"]): pid for pid, d in docs.items() for r in d["pitches"]}

    changed, added_by_season, replaced, new_ids, remapped = set(), Counter(), 0, [], 0
    if len(raw):
        raw = raw[pd.to_datetime(raw.Date, errors="coerce") >= pd.Timestamp(SINCE)]
        wv = R.prep_wvu(raw)
        # Keep each pitcher's existing entry: if most of a name's pitches are already in someone's file, use that id.
        for fid, g in wv.groupby("id"):
            owners = Counter(uid_owner[u] for u in g.PitchUID.astype(str) if u in uid_owner)
            if owners and fid not in live:             # a name the app doesn't have, mostly already in one pitcher's file
                own, k = owners.most_common(1)[0]
                if own != fid and k >= 0.5 * len(g): wv.loc[g.index, "id"] = own; remapped += 1
        # Readable opponent names: learn code -> name from pitches already in the app, keep what earlier runs learned.
        votes = defaultdict(Counter)
        live_opp = {str(r["id"]): r.get("opponent") for d in docs.values() for r in d["pitches"]}
        for u, code in zip(wv.PitchUID.astype(str), wv.opponent.astype(str)):
            nm = live_opp.get(u)
            if nm and nm != code and not re.fullmatch(r"[A-Z0-9]+_[A-Z0-9]+", nm): votes[code][nm] += 1
        for code, c in votes.items(): team_names.setdefault(code, c.most_common(1)[0][0])
        team_names.update(NAMES_FIXED)
        # Home pitches already in the app (that this run doesn't replace) also anchor the away-pitch typing.
        new_uids = set(wv.PitchUID.astype(str))
        pool = pd.DataFrame([dict(id=pid, seasonLabel=r["season"], type=(legacy_fix(r) if d.get("v") != 2 else r)["type"],
                                  RelSpeed=r["velo"], InducedVertBreak=r["ivb"], HorzBreak=r["hb"])
                             for pid, d in docs.items() for r in d["pitches"] if r.get("home") and str(r["id"]) not in new_uids])
        built = R.finish(R.match_types(wv, pool))
        built["opponent"] = built.opponent.map(lambda c: team_names.get(str(c), c))
        unnamed = sorted({c for c in wv.opponent.astype(str).unique() if c not in team_names})
        print(f"built {len(built)} WVU pitches from {built.id.nunique()} pitchers "
              f"({remapped} name spellings attached to an existing pitcher); opponents without a readable name: {unnamed}")
    else:
        built = pd.DataFrame()

    # 4. merge
    out_docs = {}
    conv = Counter()
    utc_ex = []
    # The server decides who threw a pitch: if it's now in another pitcher's rows, it leaves the old file.
    moved = {u: pid for u, pid in zip(built.PitchUID.astype(str), built.id) if u in uid_owner and uid_owner[u] != pid} if len(built) else {}
    losers = {uid_owner[u] for u in moved}
    for pid in set(docs) | (set(built.id) if len(built) else set()):
        old = docs.get(pid)
        new_rows = R.rows(built[built.id == pid]) if len(built) else []
        if not new_rows and old and old.get("v") == 2 and pid not in losers: continue
        keep = {}
        if old:
            for r in old["pitches"]:
                if str(r["id"]) in moved: continue
                if old.get("v") != 2: r = legacy_fix(r); conv["legacy rows converted"] += 1
                keep[str(r["id"])] = r
        for r in new_rows:
            o = keep.get(str(r["id"]))
            if o is not None and old.get("v") != 2:     # check the inches->feet / epoch conversion against the server's values
                conv["checked"] += 1
                conv["side ok"] += abs((o["side"] or 0) - (r["side"] or 0)) <= 0.002
                conv["height ok"] += abs((o["height"] or 0) - (r["height"] or 0)) <= 0.002
                ok_u = str(o.get("utc"))[:23] == str(r.get("utc"))[:23]
                conv["utc ok"] += ok_u
                if not ok_u and len(utc_ex) < 5: utc_ex.append((docs[pid]["pitches"][0].get("utc") and next((x.get("utc") for x in old["pitches"] if str(x["id"]) == str(r["id"])), None), o.get("utc"), r.get("utc"), r.get("home")))
            if str(r["id"]) in keep: replaced += 1
            else: added_by_season[r["season"]] += 1
            keep[str(r["id"])] = r
        pitches = sorted(keep.values(), key=lambda r: (r["date"], str(r["game"]), r.get("inning") or 0, r.get("pa") or 0, r.get("pitchNo") or 0))
        g = built[built.id == pid] if len(built) else pd.DataFrame()
        name = old["name"] if old else g.Pitcher.iloc[0]
        throws = old["throws"] if old else (g.PitcherThrows.dropna().mode().iloc[0] if g.PitcherThrows.notna().any() else "Right")
        seasons = sorted({r["season"] for r in pitches}, key=R.srank, reverse=True)
        out_docs[pid] = dict(id=pid, name=name, throws=throws, team=R.WVU, conf="BIG12", season=seasons[0], v=2, pitches=pitches)
        if not old: new_ids.append(pid)
        changed.add(pid)

    # sanity: plate location of converted legacy rows should look like feet now
    hs = [r["height"] for d in out_docs.values() for r in d["pitches"] if r.get("height") is not None]
    print(f"\nmerge: {len(changed)} pitcher files change, {len(new_ids)} new pitchers; "
          f"{sum(added_by_season.values())} pitches added {dict(sorted(added_by_season.items()))}, {replaced} replaced with the server's copy, "
          f"{conv['legacy rows converted']} older rows converted (inches -> feet etc.)")
    if conv["checked"]:
        n = conv["checked"]
        print(f"  converted older rows vs the server's copy of the same pitch ({n}): side {conv['side ok'] / n:.1%}, "
              f"height {conv['height ok'] / n:.1%}, release time {conv['utc ok'] / n:.1%} agree")
        if utc_ex: print("  release-time mismatches (app as stored, after conversion, server, home park):", utc_ex)
    if moved: print(f"  {len(moved)} pitches the server credits to a different WVU pitcher than the app did: moved to the server's pitcher")
    if hs: print(f"  plate height across WVU files: median {np.median(hs):.2f} ft, 1st-99th pct {np.percentile(hs, 1):.2f}-{np.percentile(hs, 99):.2f} ft")
    epoch_left = sum(1 for d in out_docs.values() for r in d["pitches"] if r.get("utc") and EPOCH.match(str(r["utc"])))
    print(f"  release times still in epoch format: {epoch_left}")

    # index entries
    entries = {p["id"]: p for p in idx["pitchers"]}
    for pid, d in out_docs.items():
        ps = d["pitches"]
        games = {}
        for r in ps: games[r["game"]] = min(games.get(r["game"], r["date"]), r["date"])
        seasons = sorted({r["season"] for r in ps}, key=R.srank, reverse=True)
        entries[pid] = dict(id=pid, name=d["name"], throws=d["throws"], team=R.WVU, conf="BIG12", season=seasons[0], seasons=seasons,
                            years=sorted({int(s[-4:]) for s in seasons}, reverse=True), year=int(seasons[0][-4:]),
                            fall=seasons[0].startswith("Fall"), n=len(ps), first=min(games.values()), last=max(games.values()), games=len(games))
    new_idx = dict(idx, pitchers=list(entries.values()), generated=dt.date.today().isoformat(),
                   dataThrough=max([idx.get("dataThrough") or ""] + [e["last"] for e in entries.values() if e.get("team") == R.WVU]))
    w = [e for e in entries.values() if e.get("team") == R.WVU]
    print(f"index: {len(w)} WVU pitchers (was {len(live)}), data through {new_idx['dataThrough']} (was {idx.get('dataThrough')})")
    print("  WVU pitches by season:", dict(sorted(Counter(r["season"] for d in {**docs, **out_docs}.values() for r in (d["pitches"])).items())))

    if not out_docs:
        print("\nnothing new for WVU: pitcher files, index and reference left as they are")
        if upload:
            put_json(s3, "sync/state.json.gz", {"seen": {x[0]: [x[2], x[3]] for x in csvs}, "games": done_games, "teamNames": team_names,
                                                "lastRun": dt.datetime.now(dt.timezone.utc).isoformat()})
        return

    # 5. reference from every P4 pitcher file (WVU's from this run)
    p4 = [p for p in idx["pitchers"] if p.get("conf") in P4 and p.get("team") != R.WVU]
    def pf(p):
        return p["conf"], pairs_of(get_json(s3, f"pitchers/{p['id']}.json.gz")["pitches"])
    wvu_now = {**docs, **out_docs}                 # every WVU file as it will be after this run
    frames = readers.map(pf, p4, r2=True) + [("BIG12", pairs_of(d["pitches"])) for d in wvu_now.values()]
    print(f"\nreference rebuilt from {len(p4)} other P4 pitchers + {len(wvu_now)} WVU pitchers")
    ref = reference_from(frames)
    old_ref = get_json(s3, "reference.json.gz", missing_ok=True)
    if ref is None: print("no pairs found: reference left as it is")
    for pool in (("P4", "BIG12") if ref else ()):
        new_p, old_p = ref["pools"][pool], (old_ref or {}).get("pools", {}).get(pool, {})
        print(f"reference {pool}: {len(new_p)} combos (was {len(old_p)}), {sum(c['n'] for c in new_p.values())} pairs "
              f"(was {sum(c['n'] for c in old_p.values())})")
        for combo in ["Four-Seam>Slider", "Four-Seam>Changeup", "Sinker>Slider"]:
            a, b = new_p.get(combo), old_p.get(combo)
            if a: print(f"  {combo}: n {b['n'] if b else '-'} -> {a['n']}, grade cuts (20/40/60/80th pct) "
                        f"{[b['pct'][i] for i in (3, 7, 11, 15)] if b else '-'} -> {[a['pct'][i] for i in (3, 7, 11, 15)]} in")
            if a and b and pool == "BIG12":
                tot = lambda c, k: sum(v.get(k, 0) for v in c["bins"].values())
                print(f"    chase over all bins: {tot(b, 'chases') / max(tot(b, 'outOfZone'), 1):.1%} -> {tot(a, 'chases') / max(tot(a, 'outOfZone'), 1):.1%}")

    if not upload:
        print("\nDRY RUN: nothing uploaded."); return

    # 6. upload: pitcher files, reference, index (last, so the app never points at a missing file), state
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H%M")
    put_json(s3, f"backup/{stamp}/index.json.gz", idx)                    # undo point: what the app had before this run
    if old_ref: put_json(s3, f"backup/{stamp}/reference.json.gz", old_ref)
    readers.map(lambda pid: put_json(s3, f"backup/{stamp}/pitchers/{pid}.json.gz", docs[pid]), [pid for pid in out_docs if pid in docs], r2=True)
    print(f"backed up the current index, reference and {sum(1 for pid in out_docs if pid in docs)} pitcher files to backup/{stamp}/")
    def up(pid):
        put_json(s3, f"pitchers/{pid}.json.gz", out_docs[pid]); return pid
    readers.map(up, sorted(out_docs), r2=True)
    if ref: put_json(s3, "reference.json.gz", ref)
    put_json(s3, "index.json.gz", new_idx)
    for x in use:
        k = game_key(x[1]); done_games[k] = max(done_games.get(k, 0), 1 if verified(x[1]) else 0)
    put_json(s3, "sync/state.json.gz", {"seen": {x[0]: [x[2], x[3]] for x in csvs}, "games": done_games, "teamNames": team_names,
                                        "lastRun": dt.datetime.now(dt.timezone.utc).isoformat()})
    print(f"\nuploaded {len(out_docs)} pitcher files, reference, index, state")
