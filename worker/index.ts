// Serves the data API from Cloudflare KV and everything else from the built site.
//
//   GET /data/index.json        list of pitchers (no pitch rows)
//   GET /data/pitcher/<id>.json one pitcher with all tracked pitches
//
// If KV holds no data yet (a fresh deploy), the sample file bundled with the site is
// split up and served instead, so the app always has something to show.

interface Env {
  DATA: KVNamespace;
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

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function sample(env: Env, request: Request) {
  const url = new URL(request.url);
  url.pathname = "/data/pitchers.json";
  const res = await env.ASSETS.fetch(new Request(url.toString(), request));
  if (!res.ok) return null;
  return res.json() as Promise<{ generated: string; dataThrough: string; sample: boolean; pitchers: { id: string; name: string; throws: string; season: string; pitches: unknown[] }[] }>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/data/index.json") {
      const kv = await env.DATA.get("index", "text");
      if (kv) return new Response(kv, { headers: JSON_HEADERS });
      const s = await sample(env, request);
      if (!s) return json({ error: "No data loaded." }, 404);
      return json({ generated: s.generated, dataThrough: s.dataThrough, sample: true,
        pitchers: s.pitchers.map((p) => ({ id: p.id, name: p.name, throws: p.throws, season: p.season, n: p.pitches.length })) });
    }

    const m = pathname.match(/^\/data\/pitcher\/([^/]+)\.json$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const kv = await env.DATA.get(`pitcher:${id}`, "text");
      if (kv) return new Response(kv, { headers: JSON_HEADERS });
      const s = await sample(env, request);
      const p = s?.pitchers.find((x) => x.id === id);
      return p ? json(p) : json({ error: `No pitcher ${id}.` }, 404);
    }

    if (pathname.startsWith("/api/awre/")) return awre(env, pathname);
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
