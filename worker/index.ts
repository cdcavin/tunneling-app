// Serves the data API from R2 (gzipped JSON, KV as fallback) and everything else from the built site.
//
//   GET /data/index.json        list of pitchers (no pitch rows)
//   GET /data/pitcher/<id>.json one pitcher with all tracked pitches
//
// If KV holds no data yet (a fresh deploy), the sample file bundled with the site is
// split up and served instead, so the app always has something to show.

interface Env {
  DATA: KVNamespace;
  BUCKET?: R2Bucket;       // pitch data (gzipped JSON objects); KV is the fallback for older uploads
  ASSETS: Fetcher;
  AWRE_API_KEY?: string;   // set in the Worker's Settings > Variables and Secrets; never in code
  AWRE_TEAM_ID?: string;   // defaults to WVU's id below
  AWRE_BASE?: string;
}

const AWRE_TEAM = "74632";
const AWRE_BASE = "https://api.awresports.com/api/exchange/v2";

/**
 * AWRE lookups, with the key kept on the server.
 *   GET /api/awre/pitch/<PitchUID>  ->  { pitch, clips }   (the pitch record and its camera angles)
 * Results are cached in KV for a day so repeat views don't hit AWRE.
 */
async function awre(env: Env, pathname: string): Promise<Response> {
  if (!env.AWRE_API_KEY) return json({ error: "AWRE is not connected yet (no API key on the server)." }, 503);
  const m = pathname.match(/^\/api\/awre\/pitch\/([^/]+)$/);
  if (!m) return json({ error: "Not found." }, 404);
  const uid = decodeURIComponent(m[1]);
  const cacheKey = `awre:pitch:${uid}`;
  const cached = await env.DATA.get(cacheKey, "text");
  if (cached) return new Response(cached, { headers: JSON_HEADERS });

  const team = env.AWRE_TEAM_ID ?? AWRE_TEAM;
  // The collection sends only the key; extra headers (an Accept header, say) get a 406 back.
  const headers = { Authorization: `Api-Key ${env.AWRE_API_KEY}` };
  const bases = env.AWRE_BASE ? [env.AWRE_BASE] : [AWRE_BASE, AWRE_BASE.replace("https://api.", "https://www.")];
  let p: Response | null = null, base = bases[0];
  for (const b of bases) {
    p = await fetch(`${b}/team/${team}/pitchuid/${encodeURIComponent(uid)}`, { headers });
    base = b;
    if (p.ok || p.status === 404) break;
  }
  if (p?.status === 404) return json({ error: "AWRE has no record of this pitch.", notFound: true, clips: [] }, 404);
  if (!p || !p.ok) return json({ error: `AWRE pitch lookup failed (HTTP ${p?.status}).`, detail: (await p?.text())?.slice(0, 300) }, 502);
  const pitch = (await p.json()) as { pitch?: { pitch_id?: number } };
  const pitchId = pitch.pitch?.pitch_id;
  if (!pitchId) return json({ error: "AWRE has no video record for this pitch.", pitch }, 404);
  const a = await fetch(`${base}/team/${team}/clip/ph_${pitchId}/angles`, { headers });
  if (!a.ok) return json({ error: `AWRE clip lookup failed (HTTP ${a.status}).`, detail: (await a.text()).slice(0, 300) }, 502);
  const angles = (await a.json()) as { clips?: unknown[] };
  const body = JSON.stringify({ pitch: pitch.pitch, clips: angles.clips ?? [] });
  await env.DATA.put(cacheKey, body, { expirationTtl: 86400 });
  return new Response(body, { headers: JSON_HEADERS });
}

/**
 * Weather at WVU's ballpark for one hour, from Open-Meteo (free, no key): the archive for dates older than a week,
 * the forecast API (which also serves the last few days) otherwise. Cached in KV by hour.
 *   GET /api/weather?t=<ISO UTC time>  ->  { tempF, rh, pressureHpa, windMph, windFromDeg, code, desc, airDensity (lb/ft³) }
 * Air density uses station pressure (already at the park's elevation), temperature and humidity.
 */
const PARK = { lat: 39.648, lon: -79.993 };   // Morgantown, WV (Monongalia County Ballpark area)
const WX_DESC = (c: number) => c === 0 ? "Clear" : c <= 2 ? "Partly cloudy" : c === 3 ? "Overcast" : c <= 48 ? "Fog" : c <= 57 ? "Drizzle"
  : c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Showers" : c <= 86 ? "Snow showers" : "Thunderstorm";
async function weather(env: Env, request: Request): Promise<Response> {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return json({ error: "Bad time." }, 400);
  const hour = new Date(Math.round(ms / 3600000) * 3600000).toISOString().slice(0, 13);   // nearest hour, UTC
  const key = `wx:v1:${hour}`;
  const hit = await env.DATA.get(key, "text");
  if (hit) return new Response(hit, { headers: JSON_HEADERS });
  const day = hour.slice(0, 10);
  const recent = Date.now() - ms < 7 * 86400000;
  const base = recent ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const q = `latitude=${PARK.lat}&longitude=${PARK.lon}&start_date=${day}&end_date=${day}&timezone=GMT&temperature_unit=fahrenheit&wind_speed_unit=mph`
    + "&hourly=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code";
  const r = await fetch(`${base}?${q}`);
  if (!r.ok) return json({ error: `Weather lookup failed (HTTP ${r.status}).` }, 502);
  const d = (await r.json()) as { hourly?: Record<string, (number | string | null)[]> };
  const h = d.hourly; const i = h?.time?.findIndex((x) => String(x).slice(0, 13) === hour) ?? -1;
  if (!h || i < 0 || h.temperature_2m[i] == null) return json({ error: "No weather for that hour." }, 404);
  const tempF = Number(h.temperature_2m[i]), rh = Number(h.relative_humidity_2m[i]), p = Number(h.surface_pressure[i]);
  const tc = ((tempF - 32) * 5) / 9, tk = tc + 273.15;
  const pv = (rh / 100) * 6.1078 * Math.pow(10, (7.5 * tc) / (tc + 237.3));        // hPa
  const rho = ((p - pv) * 100) / (287.058 * tk) + (pv * 100) / (461.495 * tk);      // kg/m³
  const code = Number(h.weather_code[i]);
  const body = JSON.stringify({ hour, tempF, rh, pressureHpa: p, windMph: Number(h.wind_speed_10m[i]), windFromDeg: Number(h.wind_direction_10m[i]),
    code, desc: WX_DESC(code), airDensity: rho * 0.0624280 });
  await env.DATA.put(key, body, recent ? { expirationTtl: 3 * 86400 } : {});        // recent hours get refreshed once the archive has them
  return new Response(body, { headers: JSON_HEADERS });
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function sample(env: Env, request: Request) {
  const url = new URL(request.url);
  url.pathname = "/data/pitchers.json";
  const res = await env.ASSETS.fetch(new Request(url.toString(), request));
  if (!res.ok) return null;
  return res.json() as Promise<{ generated: string; dataThrough: string; sample: boolean; pitchers: { id: string; name: string; throws: string; season: string; pitches: unknown[] }[] }>;
}

/**
 * Video pass-through: the browser can't fetch AWRE's video server directly (no CORS),
 * so playlists and segments come through here. Playlists are rewritten so every
 * segment URL also points back here. Only awresports.com hosts are allowed.
 *   GET /api/awre/stream?u=<encoded AWRE video URL>
 */
async function stream(env: Env, request: Request): Promise<Response> {
  const self = new URL(request.url);
  const raw = self.searchParams.get("u");
  if (!raw) return json({ error: "Missing u." }, 400);
  let target: URL;
  try { target = new URL(raw); } catch { return json({ error: "Bad url." }, 400); }
  // Playlists come from AWRE; the video pieces live in AWRE's S3 bucket.
  const awreHost = /(^|\.)awresports\.com$/.test(target.hostname);
  const s3Host = /^awresports-[a-z0-9-]+\.s3[.a-z0-9-]*\.amazonaws\.com$/.test(target.hostname);
  if (!awreHost && !s3Host) return json({ error: "Host not allowed." }, 403);

  const headers: Record<string, string> = {};
  if (awreHost && env.AWRE_API_KEY) headers.Authorization = `Api-Key ${env.AWRE_API_KEY}`;
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const up = await fetch(target.toString(), { headers, cf: { cacheTtl: 300, cacheEverything: true } });
  const ct = up.headers.get("content-type") ?? "";
  const isPlaylist = /mpegurl|m3u8/i.test(ct) || /\.m3u8(\?|$)/.test(target.pathname + target.search);
  const cors = { "access-control-allow-origin": "*", "cache-control": "private, max-age=300" };

  if (!isPlaylist) {
    const h = new Headers(cors);
    for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) { const v = up.headers.get(k); if (v) h.set(k, v); }
    return new Response(up.body, { status: up.status, headers: h });
  }
  const text = await up.text();
  const proxied = (u: string) => `${self.origin}/api/awre/stream?u=${encodeURIComponent(new URL(u, target).toString())}`;
  const out = text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return t.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${proxied(u)}"`);
    return proxied(t);
  }).join("\n");
  return new Response(out, { status: up.status, headers: { ...cors, "content-type": "application/vnd.apple.mpegurl" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Data objects are stored gzipped; hand the bytes through with the encoding declared so the
    // browser inflates them (encodeBody "manual" stops the edge from gzipping twice).
    // no-cache + ETag: the browser checks every load (a cheap 304 when nothing changed), so a sync shows up right away.
    const fromR2 = async (key: string) => {
      const obj = await env.BUCKET?.get(key, { onlyIf: request.headers });
      if (!obj) return null;
      const base = { "cache-control": "no-cache", etag: obj.httpEtag };
      if (!("body" in obj)) return new Response(null, { status: 304, headers: base });
      return new Response((obj as R2ObjectBody).body, { headers: { ...JSON_HEADERS, ...base, "content-encoding": "gzip" }, encodeBody: "manual" });
    };

    if (pathname === "/data/index.json") {
      const r2 = await fromR2("index.json.gz");
      if (r2) return r2;
      const kv = await env.DATA.get("index", "text");
      if (kv) return new Response(kv, { headers: JSON_HEADERS });
      const s = await sample(env, request);
      if (!s) return json({ error: "No data loaded." }, 404);
      return json({ generated: s.generated, dataThrough: s.dataThrough, sample: true,
        pitchers: s.pitchers.map((p) => ({ id: p.id, name: p.name, throws: p.throws, season: p.season, n: p.pitches.length })) });
    }

    // Pose model files (copied from Hugging Face into R2 by the "models" workflow), served from our own address.
    if (pathname.startsWith("/models/")) {
      const key = decodeURIComponent(pathname.slice(1));
      if (key.includes("..")) return json({ error: "Bad path." }, 400);
      const obj = await env.BUCKET?.get(key);
      if (!obj) return json({ error: "No such model file." }, 404);
      return new Response(obj.body, { headers: {
        "content-type": key.endsWith(".json") ? "application/json" : "application/octet-stream",
        "content-length": String(obj.size), "cache-control": "public, max-age=31536000, immutable", etag: obj.httpEtag,
      } });
    }

    if (pathname === "/data/reference.json") {
      const r2 = await fromR2("reference.json.gz");
      return r2 ?? json({ error: "No reference built yet." }, 404);
    }

    const m = pathname.match(/^\/data\/pitcher\/([^/]+)\.json$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const r2 = await fromR2(`pitchers/${id}.json.gz`);
      if (r2) return r2;
      const kv = await env.DATA.get(`pitcher:${id}`, "text");
      if (kv) return new Response(kv, { headers: JSON_HEADERS });
      const s = await sample(env, request);
      const p = s?.pitchers.find((x) => x.id === id);
      return p ? json(p) : json({ error: `No pitcher ${id}.` }, 404);
    }

    if (pathname === "/api/weather") return weather(env, request);
    if (pathname === "/api/awre/stream") return stream(env, request);
    if (pathname.startsWith("/api/awre/")) return awre(env, pathname);
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
