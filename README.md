# MoreYeahs Email Marketing Automation

An automated email marketing platform tailored for MoreYeahs. It includes:

- Campaign brief form
- MoreYeahs-specific AI-style email sequence generation
- Subject, body, timing, and score preview
- CSV lead import
- Contact scoring and segmentation
- Automation journey visualization
- Microsoft Graph sending and reply sync, with SMTP fallback
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

## Configure Microsoft Graph

Microsoft Graph is the recommended provider for Microsoft 365 because it avoids SMTP/IMAP app-password failures.

```bash
cp .env.example .env
```

Create an app registration in Microsoft Entra ID, add a web redirect URI, then add these values to `.env` or Vercel:

```bash
BASE_URL=https://your-vercel-domain.vercel.app
MICROSOFT_TENANT_ID=consumers
MICROSOFT_CLIENT_ID=your-app-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/microsoft/callback
```

For personal Outlook/Hotmail testing, set `MICROSOFT_TENANT_ID=consumers`.
For both personal and work accounts, use `MICROSOFT_TENANT_ID=common`.
For MoreYeahs-only production later, use the MoreYeahs tenant ID.

Required Microsoft Graph delegated permissions:

- `User.Read`
- `Mail.Send`
- `Mail.Read`
- `offline_access`

Then restart and connect the mailbox from the Mailbox page:

```bash
npm run automation
```

SMTP settings can still be used as a fallback if Graph is not connected.

## Frontend-Only Preview

```bash
npm run dev
```

Then visit the URL shown by Vite, usually `http://127.0.0.1:5173/`. Backend actions will show static-preview messaging in this mode.

## Static Fallback

You can also open `index.html` directly in a browser because the app is plain HTML, CSS, and JavaScript.
