# ECC Mux automation

Separate from the live members site. Three jobs:

1. **Webhook** (`/api/mux-webhook`) — on `video.asset.ready`, requests auto-generated
   subtitles and sets a default thumbnail 10% in.
2. **Subtitle swap** (`/swap.html`) — replaces Mux's auto-generated subtitles with
   corrected ones. Corrections live in `lib/corrections.js`; `/api/vtt` applies them
   on the fly so nothing needs hosting.
3. **Reviewed subtitles** (`/reviewed.html`) — publishes hand-reviewed subtitle files
   served from `/vtt/<slug>.vtt`. Used after a re-transcribe, where Mux's own
   generated track no longer exists to read from.

## Environment variables

`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`, `ADMIN_KEY`.
`/api/health` reports which are set, without revealing values.

## Running the swap

Open `/swap.html`, enter the admin key, then:

1. **Check what needs doing** — lists assets still carrying an uncorrected track.
2. **Add corrected subtitles** — attaches the corrected track to each.
3. **Remove the old ones** — deletes the auto-generated track, but only where a
   corrected one is already ready.

Safe to stop and rerun; every step skips work already done.

## Publishing reviewed subtitles

Open `/reviewed.html`, enter the admin key, press the button. Each video listed in
`public/vtt/manifest.json` has its subtitle track replaced with the reviewed file.
Safe to run more than once.
