// Serves a corrected version of a Mux auto-generated subtitle track.
//
// Mux can only attach subtitles from a URL, so rather than hosting 3MB of
// files this fetches the original from Mux's public stream, applies the
// agreed corrections, and hands back the result. Mux fetches this URL once
// when the new track is created.

import { correct } from '../lib/corrections.js';

export default async function handler(req, res) {
  const { playback, track } = req.query || {};
  if (!playback || !track) return res.status(400).json({ error: 'playback and track required' });
  if (!/^[A-Za-z0-9]+$/.test(playback) || !/^[A-Za-z0-9]+$/.test(track)) {
    return res.status(400).json({ error: 'bad identifiers' });
  }

  const url = `https://stream.mux.com/${playback}/text/${track}.vtt`;
  const upstream = await fetch(url);
  if (!upstream.ok) return res.status(502).json({ error: `mux returned ${upstream.status}` });

  const { text, counts } = correct(await upstream.text());
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Corrections', JSON.stringify(counts));
  return res.status(200).send(text);
}
