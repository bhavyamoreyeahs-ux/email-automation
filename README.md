# MoreYeahs Email Marketing Automation

An automated email marketing platform tailored for MoreYeahs. It includes:

- Campaign brief form
- MoreYeahs-specific AI-style email sequence generation
- Subject, body, timing, and score preview
- CSV lead import
- Contact scoring and segmentation
- Automation journey visualization
- Provider-ready SMTP sending with safe simulation mode
- Suppression list and unsubscribe handling
- Compliance checks for sender, subject, address, and opt-out basics
- Forecast metrics and chart
- Local draft saving
- Automation activity log

## Run Automation

Dependencies are installed with a project-local Node.js runtime in `.runtime/`.

```bash
cd automated-email-ai-platform
export PATH="$PWD/.runtime/node-v24.18.0-darwin-arm64/bin:$PATH"
npm run automation
```

Then visit `http://127.0.0.1:5174/`.

## Configure Real Sending

The app runs in safe simulation mode until SMTP settings are added.

```bash
cp .env.example .env
```

Edit `.env` with your SMTP provider settings, then restart:

```bash
npm run automation
```

Use verified sender/domain settings for `moreyeahs.com` before enabling real sends.

## Frontend-Only Preview

```bash
npm run dev
```

Then visit the URL shown by Vite, usually `http://127.0.0.1:5173/`. Backend actions will show static-preview messaging in this mode.

## Static Fallback

You can also open `index.html` directly in a browser because the app is plain HTML, CSS, and JavaScript.
