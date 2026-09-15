// Replaces Mux's auto-generated subtitle tracks with corrected ones.
//
// One asset per request so nothing runs long enough to time out; the page at
// /swap.html drives the loop and shows progress.
//
//   action "list"    -> assets that still have an uncorrected track
//   action "add"     -> attach the corrected track to one asset
//   action "cleanup" -> remove the auto track once its corrected sibling is ready
//
// Mux rate-limits hard, so every call backs off and retries rather than failing.

const API = 'https://api.mux.com/video/v1';
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function auth() {
  const { MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) throw new Error('Mux credentials not configured');
  return 'Basic ' + Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString('base64');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mux(method, path, body, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: auth(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return r.status === 204 ? {} : r.json();

    const text = (await r.text()).slice(0, 180);
    const last = i === attempts - 1;
    if (RETRY_STATUS.has(r.status) && !last) {
      const hinted = Number(r.headers.get('retry-after')) || 0;
      const wait = (hinted * 1000) || Math.min(1500 * 2 ** i, 12000);
      await sleep(wait + Math.random() * 400);
      continue;
    }
    throw new Error(`${method} ${path} -> ${r.status}: ${text}`);
  }
}

// Mux rejects a second subtitle track on the same language, so the corrected
// one goes in as en-GB. Once the generated en track is removed it is the only
// subtitle on the asset, and en-GB is the honest label for this content anyway.
const CORRECTED = 'English (UK)';
const CORRECTED_LANG = 'en-GB';
const isGenerated = (t) => t.type === 'text' && /generated/i.test(t.name || '');
const isCorrected = (t) => t.type === 'text' && !isGenerated(t);
const publicPlayback = (a) => (a.playback_ids || []).find((p) => p.policy === 'public')?.id;

async function allAssets() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const { data = [] } = await mux('GET', `/assets?limit=100&page=${page}`);
    out.push(...data);
    if (data.length < 100) break;
    await sleep(250);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { key, action, assetId, playback, trackId, staleIds, slug } = req.body || {};
  if (!process.env.ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY not configured' });
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'wrong key' });

  const host = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

  try {
    if (action === 'list') {
      const assets = await allAssets();
      const todo = [], skipped = [];
      let done = 0;
      for (const a of assets) {
        const title = a.meta?.title || a.id;
        const tracks = a.tracks || [];
        const gen = tracks.find(isGenerated);
        const cor = tracks.find(isCorrected);
        const pb = publicPlayback(a);
        if (a.status !== 'ready' || !pb) { skipped.push({ title, why: 'not ready or no public playback' }); continue; }
        if (cor && !gen) { done++; continue; }
        if (!gen) { skipped.push({ title, why: 'no generated subtitle track' }); continue; }
        // carry what "add" needs so it costs one API call instead of two
        // staleIds are corrected tracks from an earlier rule set; step 2 removes them first
        const staleIds = tracks.filter(isCorrected).map((t) => t.id);
        todo.push({ id: a.id, title, playback: pb, trackId: gen.id, staleIds });
      }
      return res.status(200).json({ todo, done, skipped });
    }

    if (action === 'add') {
      if (!assetId || !playback || !trackId) {
        return res.status(400).json({ error: 'assetId, playback and trackId required' });
      }
      // Remove any corrected track built from an older rule set. Mux allows only
      // one subtitle track per language, and a stale one would block the new one.
      let removed = 0;
      for (const id of (Array.isArray(staleIds) ? staleIds : [])) {
        try { await mux('DELETE', `/assets/${assetId}/tracks/${id}`); removed++; }
        catch (e) { /* already gone */ }
      }
      const url = `${host}/api/vtt?playback=${playback}&track=${trackId}`;
      await mux('POST', `/assets/${assetId}/tracks`, {
        url, type: 'text', text_type: 'subtitles',
        language_code: CORRECTED_LANG, name: CORRECTED, closed_captions: false,
      });
      return res.status(200).json({
        result: removed ? `replaced ${removed} stale track${removed > 1 ? 's' : ''}, corrected track requested`
                        : 'corrected track requested',
      });
    }

    // Replace an asset's corrected track with a reviewed file served from
    // /vtt/<slug>.vtt on this deployment. Used after a re-transcribe, where
    // Mux's own generated track no longer exists to read from.
    if (action === 'replace') {
      if (!assetId || !slug) return res.status(400).json({ error: 'assetId and slug required' });
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'bad slug' });

      const { data: a } = await mux('GET', `/assets/${assetId}`);
      const tracks = a.tracks || [];
      let removed = 0;
      for (const t of tracks.filter((t) => t.type === 'text')) {
        try { await mux('DELETE', `/assets/${assetId}/tracks/${t.id}`); removed++; }
        catch (e) { /* already gone */ }
      }
      // cache-bust so Mux fetches this version rather than one it saw before
      const url = `${host}/vtt/${slug}.vtt?v=${Date.now()}`;
      await mux('POST', `/assets/${assetId}/tracks`, {
        url, type: 'text', text_type: 'subtitles',
        language_code: CORRECTED_LANG, name: CORRECTED, closed_captions: false,
      });
      return res.status(200).json({
        result: `removed ${removed} old track${removed === 1 ? '' : 's'}, reviewed subtitles requested`,
      });
    }

    if (action === 'cleanup') {
      if (!assetId) return res.status(400).json({ error: 'assetId required' });
      const { data: a } = await mux('GET', `/assets/${assetId}`);
      const tracks = a.tracks || [];
      const gen = tracks.find(isGenerated);
      const cor = tracks.find(isCorrected);
      if (!gen) return res.status(200).json({ result: 'already clean' });
      if (!cor) return res.status(200).json({ result: 'no corrected track yet, skipped' });
      if (cor.status && cor.status !== 'ready') {
        return res.status(200).json({ result: `corrected track still ${cor.status}, skipped` });
      }
      await mux('DELETE', `/assets/${assetId}/tracks/${gen.id}`);
      return res.status(200).json({ result: 'auto-generated track removed' });
    }

    return res.status(400).json({ error: 'action must be list, add, cleanup or replace' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
