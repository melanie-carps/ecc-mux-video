// Mux webhook receiver.
//
// Mux calls this the moment an asset finishes processing. It then:
//   1. asks Mux to auto-generate English subtitles for the audio track
//   2. sets a default thumbnail at 10% into the video
//
// Nothing to run, nothing to remember. Upload to Mux and walk away.

import crypto from 'crypto';

const API = 'https://api.mux.com/video/v1';

// Where in the video to take the default thumbnail from, as a fraction.
// 0.10 avoids fades and title cards at the very start.
const THUMBNAIL_FRACTION = 0.10;

function auth() {
  const { MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) throw new Error('Mux credentials not configured');
  return 'Basic ' + Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString('base64');
}

// Mux signs every webhook. Without this check anyone who finds the URL could
// drive your Mux account, so a failed verification is rejected outright.
function verify(rawBody, header, secret) {
  if (!secret) throw new Error('MUX_WEBHOOK_SECRET not configured');
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=').map((s) => s.trim()))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Reject anything older than five minutes, so a captured request can't be replayed.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function mux(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? {} : res.json();
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');

  if (!verify(raw, req.headers['mux-signature'], process.env.MUX_WEBHOOK_SECRET)) {
    console.warn('rejected: bad signature');
    return res.status(401).json({ error: 'invalid signature' });
  }

  let event;
  try { event = JSON.parse(raw); }
  catch { return res.status(400).json({ error: 'bad JSON' }); }

  if (event.type !== 'video.asset.ready') {
    return res.status(200).json({ ignored: event.type });
  }

  const asset = event.data || {};
  const title = asset.meta?.title || asset.id;
  const done = [];

  // 1. Captions, unless this asset already has a text track.
  try {
    const tracks = asset.tracks || [];
    const audio = tracks.find((t) => t.type === 'audio');
    const hasText = tracks.some((t) => t.type === 'text');

    if (hasText) {
      done.push('captions: already present, skipped');
    } else if (!audio) {
      done.push('captions: no audio track, skipped');
    } else {
      await mux('POST', `/assets/${asset.id}/tracks/${audio.id}/generate-subtitles`, {
        generated_subtitles: [{ language_code: 'en', name: 'English (generated)' }],
      });
      done.push('captions: requested');
    }
  } catch (e) {
    done.push(`captions: FAILED ${e.message}`);
  }

  // 2. Default thumbnail, unless one has already been chosen by hand.
  try {
    if (asset.thumbnail_time != null) {
      done.push('thumbnail: already set, left alone');
    } else if (!asset.duration) {
      done.push('thumbnail: no duration, skipped');
    } else {
      const t = Math.round(asset.duration * THUMBNAIL_FRACTION);
      await mux('PATCH', `/assets/${asset.id}`, { thumbnail_time: t });
      done.push(`thumbnail: set to ${t}s`);
    }
  } catch (e) {
    done.push(`thumbnail: FAILED ${e.message}`);
  }

  console.log(`[${title}] ${done.join(' | ')}`);
  return res.status(200).json({ asset: asset.id, title, done });
}
