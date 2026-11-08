/** AWRE facts per pitch: has video (and center field), runners on first/second/third. null = no AWRE record. */
export interface Meta { video: boolean; cf: boolean; on1: boolean; on2: boolean; on3: boolean; outs: number | null }

/** Shared across the app, so a pitch looked up once (pitch finder, best tunnels) is never asked for again. */
export const metaCache = new Map<string, Meta | null>();

/** Look up pitches the cache doesn't have yet, 15 per request (the server's limit), four requests at a time. */
export async function loadMeta(ids: string[], onProgress: (done: number) => void) {
  const todo = [...new Set(ids)].filter((id) => !metaCache.has(id));
  let done = ids.length - todo.length; onProgress(done);
  const chunks: string[][] = []; for (let i = 0; i < todo.length; i += 15) chunks.push(todo.slice(i, i + 15));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        const r = await fetch(`/api/awre/meta?ids=${c.map(encodeURIComponent).join(",")}`);
        const j = (await r.json()) as Record<string, Meta | null>;
        for (const id of c) metaCache.set(id, j[id] ?? null);
      } catch { for (const id of c) metaCache.set(id, null); }
      done += c.length; onProgress(done);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
