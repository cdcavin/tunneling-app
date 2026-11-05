"""Typical game-time weather by month at every Big 12 baseball park, saved to R2 as parks_climate.json.gz for the app.

Source: Open-Meteo historical archive (ERA5), hourly, at each park's coordinates (src/lib/parks.ts), 2016-2025.
Game time = noon to 8 pm local, the same window the lab's pressure baseline uses. Months Feb-Jun.
Per park and month: medians of temperature, humidity, surface pressure, wind; the 10th/90th percentile temperature;
and the median air density of the individual hours (lb/ft^3, same formula as airDensityLb in parks.ts).
"""
import json, math, os, statistics as st, sys, time, urllib.request
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# key in src/lib/parks.ts -> (team, lat, lon). Keep in step with BIG12 there.
PARKS = {
    "westvirginia": ("West Virginia", 39.6442, -79.9964),
    "uarizona": ("Arizona", 32.2133, -110.9192),
    "phoenixmunicipal": ("Arizona State", 33.4489, -111.9556),
    "baylor": ("Baylor", 31.5508, -97.1078),
    "brighamyoung": ("BYU", 40.255, -111.6525),
    "ucincinnati": ("Cincinnati", 39.1301, -84.5137),
    "uofhouston": ("Houston", 29.7267, -95.3452),
    "kansasuniversity": ("Kansas", 38.953, -95.2529),
    "kansasstate": ("Kansas State", 39.2045, -96.5925),
    "okstate": ("Oklahoma State", 36.131, -97.0688),
    "tcu": ("TCU", 32.7075, -97.3683),
    "danlawfield": ("Texas Tech", 33.5886, -101.8767),
    "johneulianopark": ("UCF", 28.6094, -81.1961),
    "utah": ("Utah", 40.7531, -111.8444),
}
YEARS = (2016, 2025)
MONTHS = (2, 3, 4, 5, 6)
HOURS = range(12, 21)          # noon through the 8 pm hour, local


def density(temp_f, rh, hpa):
    tc = (temp_f - 32) * 5 / 9; tk = tc + 273.15
    pv = rh / 100 * 6.1078 * 10 ** (7.5 * tc / (tc + 237.3))
    return ((hpa - pv) * 100 / (287.058 * tk) + pv * 100 / (461.495 * tk)) * 0.062428


def fetch(lat, lon):
    q = (f"latitude={lat}&longitude={lon}&start_date={YEARS[0]}-01-01&end_date={YEARS[1]}-12-31&timezone=auto"
         "&temperature_unit=fahrenheit&wind_speed_unit=mph"
         "&hourly=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m")
    url = "https://archive-api.open-meteo.com/v1/archive?" + q
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wvu-tunneling park climate"}), timeout=120) as r:
                return json.load(r)
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}"); time.sleep(20 * (attempt + 1))
    raise SystemExit("Open-Meteo archive unreachable")


def pct(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; f = math.floor(k)
    return xs[f] + (xs[min(f + 1, len(xs) - 1)] - xs[f]) * (k - f)


def run(upload=True):
    out = {}
    for key, (team, lat, lon) in PARKS.items():
        print(f"{team} ({key})")
        d = fetch(lat, lon); h = d["hourly"]
        by = {m: [] for m in MONTHS}
        for t, tf, rh, p, w in zip(h["time"], h["temperature_2m"], h["relative_humidity_2m"], h["surface_pressure"], h["wind_speed_10m"]):
            if None in (tf, rh, p): continue
            ts = dt.datetime.fromisoformat(t)
            if ts.month in by and ts.hour in HOURS:
                by[ts.month].append((tf, rh, p, w if w is not None else float("nan"), density(tf, rh, p)))
        months = {}
        for m, xs in by.items():
            if not xs: continue
            col = lambda i: [x[i] for x in xs if not math.isnan(x[i])]
            months[str(m)] = {"tempF": round(st.median(col(0)), 1), "tempLo": round(pct(col(0), 0.1), 1), "tempHi": round(pct(col(0), 0.9), 1),
                              "rh": round(st.median(col(1)), 1), "hPa": round(st.median(col(2)), 1), "windMph": round(st.median(col(3)), 1),
                              "rho": round(st.median(col(4)), 6), "n": len(xs)}
            print(f"  {m}: {months[str(m)]}")
        out[key] = {"team": team, "elevationM": d.get("elevation"), "tz": d.get("timezone"), "months": months}
        time.sleep(3)
    doc = {"generated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z", "years": list(YEARS),
           "hours": [HOURS.start, HOURS.stop - 1], "parks": out}
    if upload:
        from sync import r2, put_json
        put_json(r2(), "parks_climate.json.gz", doc)
        print(f"uploaded parks_climate.json.gz ({len(out)} parks)")
    else:
        print(json.dumps(doc)[:2000])


if __name__ == "__main__":
    run(upload=os.environ.get("MODE") == "climate")
