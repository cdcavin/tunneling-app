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
  AWRE_API_KEY?: string;
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

    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
