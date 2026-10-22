"""Trackman FTP sync.

explore: connect and print the folder layout (names and counts only).
peek:    walk all of /v3, summarise the game files, and open a few sample files to print their columns
         and team / league / pitch-type values. Never prints player names, the host, user or password.
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


f = FTP()
if MODE == "explore":
    explore(f)
elif MODE == "peek":
    peek(f)
