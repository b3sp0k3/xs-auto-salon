# X's Auto Salon Website

Static one-page website for X's Auto Salon, LLC, built to host on Vercel's free tier.

## Local Preview

```bash
npm run preview
```

Open `http://127.0.0.1:4173`.

## Production Build

```bash
npm run build
```

The Vercel deployment uses `vercel.json` to run the build and serve `dist/`.

## Vercel Deploy

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New Project** and import the repository.
3. Keep the detected settings from `vercel.json`:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Deploy.

The appointment-request form uses a Vercel Node.js function at `/api/appointment-request`.

## Appointment Request Delivery Setup

The form intentionally reports itself unavailable and does not claim a request was sent until all delivery and spam-protection settings are present. For review deployments, add these as Vercel **Preview** environment variables (keep production unchanged until separately approved):

- `RESEND_API_KEY` — a Resend API key with permission to send mail.
- `RESEND_FROM_EMAIL` — a sender address on a domain verified with Resend.
- `TURNSTILE_SITE_KEY` — the public Cloudflare Turnstile site key.
- `TURNSTILE_SECRET_KEY` — the matching Turnstile secret.

Configure the Turnstile widget to allow the exact review-preview hostname and, when separately approved, `xsautosalon.com` and `www.xsautosalon.com`. The request function verifies the token server-side and emails `xsautosalon@gmail.com` through Resend. Until these settings are supplied, the form stays safely unavailable and directs visitors to the salon's phone and email links. No request is stored by the website; optional photos are attached directly to the email.

The repository's automated checks mock delivery calls and never send a test email.
