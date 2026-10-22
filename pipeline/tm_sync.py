"""Trackman FTP sync.

explore: connect and print the folder layout (names and counts only), so the download step can be
written against the real structure. Never prints the host, user or password.
"""
import ftplib, os, sys

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


f = FTP()
if MODE == "explore":
    explore(f)
