// A plain GET you can open in a browser to confirm the deployment is alive
// and that the environment variables are set. It never reveals their values.

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'ecc-mux-automation',
    version: '1.5.0',
    env: {
      MUX_TOKEN_ID: Boolean(process.env.MUX_TOKEN_ID),
      MUX_TOKEN_SECRET: Boolean(process.env.MUX_TOKEN_SECRET),
      MUX_WEBHOOK_SECRET: Boolean(process.env.MUX_WEBHOOK_SECRET),
      ADMIN_KEY: Boolean(process.env.ADMIN_KEY),
    },
    correctedTrack: { name: 'English (UK)', language: 'en-GB' },
    webhookPath: '/api/mux-webhook',
    swapPage: '/swap.html',
    reviewedPage: '/reviewed.html',
  });
}
