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

No backend, environment variables, or paid services are required.
