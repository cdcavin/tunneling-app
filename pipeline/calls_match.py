"""Pitch calls from the paper charts -> Trackman pitches, saved to R2 as calls.json.gz for the app.

The charts (pipeline/calls/*.csv) carry date, page, pitch # on the page, a pitcher code (sha256 of his last name, so the
public repo holds no names), the call (e.g. SLGL), pitch type, location code and result. No inning / at-bat / count, so
each pitcher's charted pitches on a date are lined up against his Trackman pitches that date in time order, with a
sequence alignment (Needleman-Wunsch) scored on pitch type and pitch result. That absorbs pitches that are on one side
and not the other (a missed chart row, a pickoff, a Trackman miss).

Output: {uid: {"call", "loc", "type", "result", "chart": "page-#", "date", "typeOk", "resultOk"}} plus a summary.
"""
import csv, glob, hashlib, json, os, sys
from collections import defaultdict
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync import r2, get_json, put_json

WVU = {"WES_MOU", "WES_VIR4", "West Virginia"}
TYPE = {"Four-Seam": "FF", "Fastball": "FF", "Sinker": "SK", "Slider": "SL", "Sweeper": "SW", "Curveball": "CB",
        "Changeup": "CH", "Cutter": "CT", "Splitter": "SP"}
CALL = {"BallCalled": "B", "BallinDirt": "B", "BallIntentional": "B", "StrikeCalled": "S", "StrikeSwinging": "W",
        "FoulBall": "F", "FoulBallNotFieldable": "F", "FoulBallFieldable": "F", "InPlay": "X", "HitByPitch": "H"}


def h(last):
    return hashlib.sha256(("wvu-calls:" + last.strip().lower()).encode()).hexdigest()[:12]


def chart_result(r):
    r = r.replace("?", "").strip()
    if r in ("B", "BB"): return "B"
    if r in ("S", "Kc"): return "S"
    if r in ("W", "K") or r.startswith("K "): return "W"
    if r in ("F", "FL") or r.startswith("F,"): return "F"
    if r == "HBP": return "H"
    return "X" if r else ""


def align(chart, tm):
    """Needleman-Wunsch: chart rows vs Trackman rows. Returns [(chart_i, tm_j)] for matched pairs."""
    GAP = -2.0
    def sim(c, t):
        s = 0.0
        if c["type"] and t["t"]: s += 2.0 if c["type"] == t["t"] else -1.0
        cr = chart_result(c["result"])
        if cr and t["c"]: s += 2.0 if cr == t["c"] else -2.0
        return s
    n, m = len(chart), len(tm)
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    P = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): S[i][0] = i * GAP; P[i][0] = 1
    for j in range(1, m + 1): S[0][j] = j * GAP; P[0][j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            opts = (S[i - 1][j - 1] + sim(chart[i - 1], tm[j - 1]), S[i - 1][j] + GAP, S[i][j - 1] + GAP)
            k = max(range(3), key=lambda x: opts[x]); S[i][j] = opts[k]; P[i][j] = (0, 1, 2)[k]
    i, j, out = n, m, []
    while i > 0 or j > 0:
        p = P[i][j] if i > 0 and j > 0 else (1 if i > 0 else 2)
        if p == 0: out.append((i - 1, j - 1)); i -= 1; j -= 1
        elif p == 1: i -= 1
        else: j -= 1
    return out[::-1]


def run(upload=True):
    here = os.path.dirname(os.path.abspath(__file__))
    chart_rows = []
    for path in sorted(glob.glob(os.path.join(here, "calls", "*.csv"))):
        chart_rows += list(csv.DictReader(open(path, encoding="utf-8")))
    chart_rows = [r for r in chart_rows if r["type"] != "PO"]
    print(f"chart: {len(chart_rows)} pitches (pickoffs dropped)")

    s3 = r2()
    idx = get_json(s3, "index.json.gz")
    wvu = [p for p in idx["pitchers"] if p.get("team") in WVU]
    dates = {r["date"] for r in chart_rows}
    near = {(dt.date.fromisoformat(d) + dt.timedelta(days=k)).isoformat() for d in dates for k in (-1, 0, 1)}
    tm = defaultdict(list)                      # (date, pitcher code) -> Trackman pitches in time order
    for p in wvu:
        doc = get_json(s3, f"pitchers/{p['id']}.json.gz")
        code = h(p["name"].split()[-1])
        for r in doc["pitches"]:
            if r.get("date") in near:
                tm[(r["date"], code)].append({"id": str(r["id"]), "utc": r.get("utc") or "", "t": TYPE.get(r.get("type"), ""),
                                              "c": CALL.get(r.get("call"), "")})
    for v in tm.values(): v.sort(key=lambda x: x["utc"])

    groups = defaultdict(list)
    for r in chart_rows: groups[(r["date"], r["p"])].append(r)
    for v in groups.values(): v.sort(key=lambda r: (int(r["page"] or 0), int(r["n"] or 0)))

    out, report, unmatched_dates = {}, [], defaultdict(int)
    for (date, code), chart in sorted(groups.items()):
        # the sheet date can be a day off from Trackman's: take the same day if he pitched then, else the nearer one
        cands = [d for d in (date, (dt.date.fromisoformat(date) - dt.timedelta(days=1)).isoformat(),
                             (dt.date.fromisoformat(date) + dt.timedelta(days=1)).isoformat()) if tm.get((d, code))]
        if not cands:
            unmatched_dates[date] += len(chart); continue
        best = None
        for d in cands:
            pairs = align(chart, tm[(d, code)])
            ok = sum(1 for i, j in pairs if chart[i]["type"] == tm[(d, code)][j]["t"])
            if best is None or ok > best[0]: best = (ok, d, pairs)
        _, d, pairs = best
        seq = tm[(d, code)]
        for i, j in pairs:
            c, t = chart[i], seq[j]
            cr = chart_result(c["result"])
            out[t["id"]] = {"call": c["call"], "loc": c["loc"], "type": c["type"], "result": c["result"],
                            "chart": f'{c["page"]}-{c["n"]}', "date": c["date"],
                            "typeOk": c["type"] == t["t"], "resultOk": (not cr) or cr == t["c"]}
        report.append((date, d, code, len(chart), len(seq), len(pairs),
                       sum(out[seq[j]["id"]]["typeOk"] for _, j in pairs), sum(out[seq[j]["id"]]["resultOk"] for _, j in pairs)))

    tot_c = sum(r[3] for r in report); tot_m = sum(r[5] for r in report)
    print(f"\nmatched {tot_m} of {tot_c} charted pitches that have a Trackman session "
          f"(type agrees on {sum(r[6] for r in report)}, result agrees on {sum(r[7] for r in report)})")
    if unmatched_dates: print("charted pitches with no Trackman session for that pitcher (±1 day):", dict(unmatched_dates))
    shifted = sorted({(r[0], r[1]) for r in report if r[0] != r[1]})
    if shifted: print("sheet date -> Trackman date used:", shifted)
    weak = [r for r in report if r[5] and (r[6] / r[5] < 0.8 or r[7] / r[5] < 0.8)]
    print(f"\nper pitcher-day: {len(report)} lined up; {len(weak)} with under 80% type or result agreement:")
    for r in weak:
        print(f"  {r[0]} (TM {r[1]}) pitcher {r[2][:6]}: chart {r[3]}, Trackman {r[4]}, matched {r[5]}, type ok {r[6]}, result ok {r[7]}")
    if upload:
        put_json(s3, "calls.json.gz", {"generated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z", "calls": out})
        print(f"\nuploaded calls.json.gz ({len(out)} pitches)")


if __name__ == "__main__":
    run(upload=os.environ.get("MODE") == "calls")
