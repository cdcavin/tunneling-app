"""Trackman FTP sync.

explore: connect and print the folder layout (names and counts only).
peek:    walk all of /v3, summarise the game files, and open a few sample files to print their columns
         and team / league / pitch-type values.
dry:     build WVU pitch rows from every WVU-park game/scrimmage file (2025 on) and compare them with what's
         live in R2. Uploads nothing.
Never prints player names, the host, user or password.
"""
import ftplib, io, os, re, sys

HOST, USER, PASS = os.environ.get("TM_FTP_HOST", ""), os.environ.get("TM_FTP_USER", ""), os.environ.get("TM_FTP_PASS", "")
PROTO = (os.environ.get("TM_FTP_PROTOCOL") or "auto").lower()
MODE = os.environ.get("MODE", "explore")
for v in (HOST, USER, PASS):
    if v: print(f"::add-mask::{v}")
if not (HOST and USER and PASS):
    sys.exit("Missing secrets: add TM_FTP_HOST, TM_FTP_USER and TM_FTP_PASS under Settings > Secrets and variables > Actions.")


class FTP:
    """Same three calls over FTPS, FTP or SFTP."""
    def __init__(self):
        self.kind, self.c = None, None
        errors = []
        order = [PROTO] if PROTO in ("sftp", "ftps", "ftp") else ["sftp", "ftps", "ftp"]
        for kind in order:
            try:
                if kind == "sftp":
                    import paramiko
                    t = paramiko.Transport((HOST, 22)); t.banner_timeout = 20
                    t.connect(username=USER, password=PASS)
                    self.c = paramiko.SFTPClient.from_transport(t)
                elif kind == "ftps":
                    c = ftplib.FTP_TLS(HOST, timeout=30); c.login(USER, PASS); c.prot_p(); self.c = c
                else:
                    c = ftplib.FTP(HOST, timeout=30); c.login(USER, PASS); self.c = c
                self.kind = kind
                print(f"connected over {kind.upper()}")
                return
            except Exception as e:
                errors.append(f"{kind}: {type(e).__name__}")
        sys.exit("Could not connect (" + "; ".join(errors) + "). Check the secrets, or set TM_FTP_PROTOCOL to sftp, ftps or ftp.")

    def ls_attr(self, path):
        """[(name, is_dir, size, mtime)] for one folder (SFTP only; that's what this server uses)."""
        import stat
        return [(a.filename, stat.S_ISDIR(a.st_mode), a.st_size, a.st_mtime) for a in self.c.listdir_attr(path)]

    def read(self, path) -> bytes:
        if self.kind == "sftp":
            with self.c.open(path, "rb") as fh: return fh.read()
        buf = io.BytesIO(); self.c.retrbinary(f"RETR {path}", buf.write); return buf.getvalue()

    def ls(self, path):
        """[(name, is_dir)] for one folder."""
        if self.kind == "sftp":
            import stat
            return [(a.filename, stat.S_ISDIR(a.st_mode)) for a in self.c.listdir_attr(path)]
        out = []
        try:
            for name, facts in self.c.mlsd(path):
                if name not in (".", ".."): out.append((name, facts.get("type") == "dir"))
            return out
        except ftplib.error_perm:
            names = [n.rsplit("/", 1)[-1] for n in self.c.nlst(path)]
            for n in names:
                p = f"{path.rstrip('/')}/{n}"
                try: self.c.cwd(p); self.c.cwd("/"); out.append((n, True))
                except ftplib.error_perm: out.append((n, False))
            return out


def explore(f: FTP, path="/", depth=0, max_depth=5):
    """Print a compact tree: up to 6 folders per level, plus counts and sample file names."""
    try:
        items = sorted(f.ls(path))
    except Exception as e:
        print("  " * depth + f"(can't list: {type(e).__name__})"); return
    dirs = [n for n, d in items if d]; files = [n for n, d in items if not d]
    exts = {}
    for n in files: exts[n.rsplit(".", 1)[-1].lower() if "." in n else "(none)"] = exts.get(n.rsplit(".", 1)[-1].lower() if "." in n else "(none)", 0) + 1
    print("  " * depth + f"{path}  [{len(dirs)} folders, {len(files)} files {exts if files else ''}]")
    for n in files[:3]: print("  " * (depth + 1) + f"- {n}")
    if depth >= max_depth: return
    # Show the first two and last four folders at each level (latest dates usually sort last).
    shown = dirs if len(dirs) <= 6 else dirs[:2] + dirs[-4:]
    if len(dirs) > 6: print("  " * (depth + 1) + f"... ({len(dirs) - 6} more folders, e.g. {dirs[2]} … {dirs[-5]})")
    for n in shown: explore(f, f"{path.rstrip('/')}/{n}", depth + 1, max_depth)


# ---------- peek ----------
SKIP = re.compile(r"_(playerpositioning|battracking|playertracking|playevents)", re.I)
WVU_NAME = re.compile(r"monogalia|westvirginia|west ?virginia|wvu|morgantown|mylan", re.I)
NAME_COLS = {"Pitcher", "Batter", "Catcher", "PitcherId", "BatterId", "CatcherId"}  # never printed


def walk_v3(f: FTP):
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


def stem(name):
    """'20260109-WestVirginia-Private-1_unverified.csv' -> 'WestVirginia-Private'."""
    m = re.match(r"\d{8}-(.+?)-\d+(_.*)?\.csv$", name)
    return m.group(1) if m else name


def describe(f: FTP, path, label):
    import pandas as pd
    raw = f.read(path)
    df = pd.read_csv(io.BytesIO(raw), low_memory=False)
    print(f"\n===== {label}: {path.rsplit('/', 1)[-1]}  ({len(raw)/1e6:.2f} MB, {len(df)} rows, {df.shape[1]} cols)")
    print("columns:", ", ".join(c for c in df.columns))
    for c in ["PitcherTeam", "BatterTeam", "HomeTeam", "AwayTeam", "League", "Level", "Stadium",
              "TaggedPitchType", "AutoPitchType", "PitchCall", "PlayResult", "KorBB", "TaggedHitType"]:
        if c in df.columns:
            vc = df[c].astype(str).value_counts(dropna=False).head(12)
            print(f"  {c}: " + ", ".join(f"{k}={v}" for k, v in vc.items()))
    for c in ["PitchUID", "UTCDateTime", "Date", "Time", "x0", "pfxx", "ax0", "RelSpeed", "SpinRate", "ExitSpeed"]:
        if c in df.columns:
            print(f"  {c}: {df[c].notna().mean():.0%} filled, e.g. {df[c].dropna().astype(str).iloc[0] if df[c].notna().any() else '-'}")
        else:
            print(f"  {c}: MISSING")
    if "PitchUID" in df.columns:
        print(f"  PitchUID unique: {df['PitchUID'].nunique()} of {len(df)}")
    return df


def peek(f: FTP):
    files = walk_v3(f)
    csvs = [x for x in files if x[1].lower().endswith(".csv") and not SKIP.search(x[1])]
    print(f"/v3: {len(files)} files, {len(csvs)} pitch CSVs (positioning/tracking files excluded)")
    print(f"total pitch-CSV size: {sum(x[2] for x in csvs)/1e9:.2f} GB")
    by_year = {}
    for p, n, sz, mt in csvs:
        gy = n[:4]; v = "unverified" if "_unverified" in n else "verified"
        by_year.setdefault(gy, {"verified": 0, "unverified": 0}); by_year[gy][v] += 1
    print("pitch CSVs by game year (from the file name):", {k: by_year[k] for k in sorted(by_year)})

    wvu = [x for x in csvs if WVU_NAME.search(x[1])]
    stems = {}
    for p, n, sz, mt in wvu: stems[(n[:4], stem(n))] = stems.get((n[:4], stem(n)), 0) + 1
    print("\nWVU-park file names (game year, stadium part of name): count")
    for k in sorted(stems): print(f"  {k[0]}  {k[1]}: {stems[k]}")

    # Games with both a verified and an unverified copy: how often, and does the verified one come later?
    names = {}
    for p, n, sz, mt in csvs: names.setdefault(n.replace("_unverified", ""), []).append((p, n, sz, mt))
    both = [v for v in names.values() if len({("_unverified" in n) for _, n, _, _ in v}) == 2]
    only_unv = sum(1 for v in names.values() if all("_unverified" in n for _, n, _, _ in v))
    print(f"\ngames with both copies: {len(both)}; only unverified: {only_unv}; same name delivered more than once: "
          f"{sum(1 for v in names.values() if len([1 for _, n, _, _ in v if '_unverified' not in n]) > 1)}")

    # Sample files: newest WVU scrimmage, newest WVU-park spring game, one D1 game from the Feb 2026 batch,
    # and one verified/unverified pair.
    newest = lambda xs: max(xs, key=lambda x: x[1]) if xs else None
    picks = [
        ("WVU fall scrimmage", newest([x for x in wvu if "Private" in x[1]])),
        ("WVU-park spring game", newest([x for x in wvu if "Private" not in x[1] and "BP" not in x[1] and x[1][4:6] in ("02", "03", "04", "05", "06")])),
        ("D1 game (Feb 2026 batch)", next((x for x in csvs if x[0].startswith("/v3/2026/02/27/") and not WVU_NAME.search(x[1]) and "_unverified" not in x[1] and "Private" not in x[1]), None)),
    ]
    pair = next((v for v in both if v[0][1][:4] == "2026"), both[0] if both else None)
    for label, x in picks:
        if x: describe(f, x[0], label)
        else: print(f"\n===== {label}: none found")
    if pair:
        ver = next(x for x in pair if "_unverified" not in x[1]); unv = next(x for x in pair if "_unverified" in x[1])
        a = describe(f, ver[0], "pair, verified"); b = describe(f, unv[0], "pair, unverified")
        print(f"\npair: verified {len(a)} rows vs unverified {len(b)} rows; columns only in one: "
              f"{sorted(set(a.columns) ^ set(b.columns))}")
        if "PitchUID" in a.columns and "PitchUID" in b.columns:
            m = a.merge(b, on="PitchUID", suffixes=("_v", "_u"))
            diff = [c for c in a.columns if c in b.columns and c != "PitchUID" and c not in NAME_COLS
                    and (m[f"{c}_v"].astype(str) != m[f"{c}_u"].astype(str)).mean() > 0.01]
            print(f"  {len(m)} pitches in both; columns that differ on >1% of them: {diff}")


# ---------- dry run ----------
def pick_files(csvs, since="20250101"):
    """WVU-park game/scrimmage/BP files from `since` on: one per game, verified copy if it exists, newest delivery."""
    best = {}
    for p, n, sz, mt in csvs:
        if not WVU_NAME.search(n) or n[:8] < since: continue
        key = n.replace("_unverified", "")
        rank = (0 if "_unverified" in n else 1, p)            # verified beats unverified, then latest folder
        if key not in best or rank > best[key][0]: best[key] = (rank, p, n)
    return [(p, n) for _, p, n in best.values()]


def kind(n):
    return "BP" if "-BP-" in n else ("Private" if "-Private-" in n else "game")


def r2_client():
    k, sec = os.environ.get("R2_KEY", "").strip(), os.environ.get("R2_SECRET", "").strip()
    if not (k and sec): return None
    for v in (k, sec): print(f"::add-mask::{v}")
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url="https://7e54275932eb85e9ef346c9e2d731750.r2.cloudflarestorage.com",
                        aws_access_key_id=k, aws_secret_access_key=sec, region_name="auto", config=Config(retries={"max_attempts": 8}))


def r2_json(s3, key):
    import gzip, json
    body = s3.get_object(Bucket="tunneling-data", Key=key)["Body"].read()
    try: body = gzip.decompress(body)
    except OSError: pass
    return json.loads(body)


def WVU_ID(name):
    return "WES_MOU__" + re.sub(r"[^a-z0-9]+", "-", re.sub(r"\s+", " ", str(name).strip()).lower()).strip("-")


def dry(f: FTP):
    import pandas as pd
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import rows as R

    files = walk_v3(f)
    csvs = [x for x in files if x[1].lower().endswith(".csv") and not SKIP.search(x[1])]
    picked = pick_files(csvs)
    kinds = {}
    for _, n in picked: kinds[kind(n)] = kinds.get(kind(n), 0) + 1
    print(f"WVU-park files since 2025 (one per game, verified preferred): {len(picked)} {kinds}; "
          f"unverified-only: {sum(1 for _, n in picked if '_unverified' in n)}")

    frames, empty, bad = [], 0, []
    for p, n in sorted(picked, key=lambda x: x[1]):
        try:
            df = pd.read_csv(io.BytesIO(f.read(p)), low_memory=False)
        except Exception as e:
            bad.append((n, type(e).__name__)); continue
        if df.empty: empty += 1; continue
        df["_kind"] = kind(n); df["_file"] = n
        frames.append(df)
    raw = pd.concat(frames, ignore_index=True)
    print(f"read {len(frames)} files, {len(raw)} rows; empty files: {empty}; unreadable: {bad[:5]}")
    missing = [c for c in R.TRAJ + ["Top/Bottom", "TaggedPitchType", "UTCDateTime", "PlayResult", "KorBB", "ExitSpeed"] if c not in raw.columns]
    print("needed columns missing:", missing or "none")
    if missing: sys.exit("Stopping: the files don't have every column the app needs.")
    print("PitcherTeam values (top):", raw.PitcherTeam.astype(str).value_counts().head(6).to_dict())

    # Which team codes are WVU? Break the WVU-looking codes down by season, file kind and park, and check
    # whether the same pitchers (by name, never printed) also show up under WES_MOU.
    d = pd.to_datetime(raw.Date, errors="coerce")
    raw["_season"] = (d.dt.month >= 8).map({True: "Fall ", False: ""}) + d.dt.year.astype("Int64").astype(str)
    nk = raw.Pitcher.astype(str).str.strip().str.replace(r"\s+", " ", regex=True).str.lower()
    wes = set(nk[raw.PitcherTeam == "WES_MOU"])
    col = lambda c: raw[c].astype(str) if c in raw.columns else pd.Series("-", index=raw.index)
    codes = [c for c in raw.PitcherTeam.astype(str).unique() if re.search(r"WES_|WVN|WVU|West Virginia", c)]
    print("\nWVU-looking team codes:", codes)
    for c in codes:
        m = raw.PitcherTeam.astype(str) == c
        names = set(nk[m])
        print(f"  {c}: {m.sum()} pitches, {len(names)} pitchers, {len(names & wes)} of them also pitch as WES_MOU")
        print(f"    by season/kind: {raw[m].groupby(['_season', '_kind']).size().to_dict()}")
        print(f"    HomeTeam: {col("HomeTeam")[m].value_counts().head(4).to_dict()} | AwayTeam: {col("AwayTeam")[m].value_counts().head(4).to_dict()}")
        print(f"    BatterTeam: {col("BatterTeam")[m].value_counts().head(4).to_dict()} | Stadium: {col("Stadium")[m].value_counts().head(3).to_dict()} | League: {col("League")[m].value_counts().head(3).to_dict()}")

    # Same verified/unverified game: how do the date/time fields differ? (video sync uses UTCDateTime)
    pair = next(((p, n) for p, n in picked if "_unverified" not in n and any(x[1] == n.replace(".csv", "_unverified.csv") for x in csvs)), None)
    if pair:
        unv = next(x for x in csvs if x[1] == pair[1].replace(".csv", "_unverified.csv"))
        a = pd.read_csv(io.BytesIO(f.read(pair[0])), low_memory=False); b = pd.read_csv(io.BytesIO(f.read(unv[0])), low_memory=False)
        m = a.merge(b, on="PitchUID", suffixes=("_v", "_u"))
        print(f"\nverified vs unverified ({kind(pair[1])}, {len(m)} shared pitches):")
        for c in ["UTCDateTime", "Date", "Time", "PitcherThrows", "PitchCall"]:
            d = m[m[f"{c}_v"].astype(str) != m[f"{c}_u"].astype(str)]
            ex = f" e.g. verified {d[f'{c}_v'].iloc[0]!r} vs unverified {d[f'{c}_u'].iloc[0]!r}" if len(d) else ""
            print(f"  {c}: {len(d)} differ{ex}")

    wv = R.prep_wvu(raw[raw._kind != "BP"])
    unmapped = wv[wv.type.isna()].TaggedPitchType.astype(str).value_counts().to_dict()
    built = R.finish(R.match_away_types(wv))
    print(f"\nbuilt {len(built)} WVU pitches from {built.id.nunique()} pitchers (BP files left out)")
    print("  by season:", built.seasonLabel.value_counts().sort_index().to_dict())
    print("  by type:", built.type.value_counts().to_dict())
    print("  tags not mapped to a type (dropped):", unmapped)
    print(f"  dropped for missing trajectory/location: {len(wv) - len(built) - sum(unmapped.values())} (approx)")

    s3 = r2_client()
    if not s3:
        print("\nR2_KEY / R2_SECRET not set: skipping the comparison with the live data."); return
    try:
        idx = r2_json(s3, "index.json.gz")
    except Exception as e:
        code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
        sys.exit(f"\nR2 refused the keys ({code}). SignatureDoesNotMatch = R2_SECRET is wrong; InvalidAccessKeyId = R2_KEY is wrong. "
                 "Re-paste the values from Colab into the GitHub secrets.")
    live = [p for p in idx["pitchers"] if p.get("team") == R.WVU]
    ids_live, ids_built = {p["id"] for p in live}, set(built.id)
    print(f"\nlive app: {len(live)} WVU pitchers, data through {idx.get('dataThrough')}")
    print(f"  pitcher ids: {len(ids_live & ids_built)} match, {len(ids_built - ids_live)} only in FTP files, {len(ids_live - ids_built)} only in app")

    # Which kind of file each live pitch came from (by PitchUID), and how well rebuilt rows agree with live rows.
    src = dict(zip(raw.PitchUID.astype(str), raw._kind))
    new_rows = {r["id"]: r for pid, g in built.groupby("id") for r in R.rows(g)}
    from collections import Counter
    origin, agree, seen = Counter(), Counter(), set()
    fields = ["type", "utc", "call", "velo", "side", "height", "season", "home", "result", "ev", "count", "opponent"]
    live_by_season = Counter()
    # Mismatch details (no player names: names are shown only as their letter pattern, e.g. "Aa, Aa").
    bname = dict(zip(built.PitchUID.astype(str), built.Pitcher))
    shape = lambda nm: re.sub(r"a+", "a", re.sub(r"A+", "A", re.sub(r"[a-z]", "a", re.sub(r"[A-Z]", "A", str(nm)))))
    flip = lambda nm: (lambda parts: f"{parts[-1]}, {' '.join(parts[:-1])}")(str(nm).split()) if " " in str(nm) else str(nm)
    name_pat, id_map, opp, typ, utc_ex, loc = Counter(), {}, Counter(), Counter(), [], []
    for p in live:
        doc = r2_json(s3, f"pitchers/{p['id']}.json.gz")
        for r in doc["pitches"]:
            b = new_rows.get(r["id"])
            if b:
                bn = bname[str(r["id"])]
                id_map.setdefault(p["id"], set()).add(WVU_ID(bn))
                name_pat[(shape(doc.get("name", "")), shape(bn), "same slug" if WVU_ID(doc.get("name", "")) == WVU_ID(bn) else
                          ("same once first/last order is swapped" if WVU_ID(doc.get("name", "")) in (WVU_ID(flip(bn)), WVU_ID(flip(flip(bn)))) or WVU_ID(flip(doc.get("name", ""))) == WVU_ID(bn) else "different"))] += 1
                if r.get("opponent") != b.get("opponent"): opp[(r.get("opponent"), b.get("opponent"))] += 1
                if r.get("type") != b.get("type"): typ[(r.get("type"), b.get("type"))] += 1
                if r.get("utc") != b.get("utc") and len(utc_ex) < 6: utc_ex.append((r.get("utc"), b.get("utc"), r.get("home"), r.get("season")))
                loc.append((r["side"], b["side"], r["height"], b["height"]))
            live_by_season[r["season"]] += 1
            origin[(r["season"], src.get(str(r["id"]), "not in WVU-park files (away)"))] += 1
            b = new_rows.get(r["id"])
            if not b: continue
            seen.add(r["id"]); agree["_n"] += 1
            for k in fields:
                if r.get(k) == b.get(k): agree[k] += 1
            if all(abs((r["coeffs"].get(k) or 0) - (b["coeffs"].get(k) or 0)) < 1e-4 for k in b["coeffs"]): agree["coeffs"] += 1
    print("  live WVU pitches by season:", dict(sorted(live_by_season.items())))
    print("  where they came from:")
    for (season, k), v in sorted(origin.items()): print(f"    {season:10s} {k}: {v}")
    n = agree.pop("_n", 0)
    print(f"  {n} live pitches rebuilt from FTP files; fields that match:", {k: f"{v / n:.1%}" for k, v in agree.items()} if n else "-")
    print("\n  name patterns (live app, FTP, does the id match?):")
    for k, v in name_pat.most_common(8): print(f"    {k}: {v} pitches")
    print(f"  live pitchers whose pitches map to exactly one FTP pitcher: {sum(1 for v in id_map.values() if len(v) == 1)} of {len(id_map)}")
    print("  opponent (live, FTP), top:", opp.most_common(10))
    print("  type (live, FTP), top:", typ.most_common(8))
    print("  utc examples (live, FTP, home, season):", utc_ex)
    if loc:
        import numpy as np
        L = np.array(loc, dtype=float)
        for j, nm in [(0, "side"), (2, "height")]:
            a, b = L[:, j], L[:, j + 1]
            print(f"  {nm}: corr {np.corrcoef(a, b)[0, 1]:.4f}, median live-FTP {np.median(a - b):+.4f} ft, "
                  f"median |live-FTP| {np.median(np.abs(a - b)):.4f}, live == -FTP: {np.mean(np.abs(a + b) < 0.002):.1%}, "
                  f"slope {np.polyfit(b, a, 1)[0]:.4f}")
        print("  location examples (live side, FTP side, live height, FTP height):", [tuple(round(x, 3) for x in t) for t in loc[:6]])
    new = built[~built.PitchUID.astype(str).isin(seen)]
    print(f"  pitches in FTP files but not in the app (would be added): {len(new)} by season {new.seasonLabel.value_counts().sort_index().to_dict()}")


f = FTP()
if MODE == "dry":
    dry(f)
elif MODE == "explore":
    explore(f)
elif MODE == "peek":
    peek(f)
