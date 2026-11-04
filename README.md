# ContextBridge browser extension

A Chrome Manifest V3 extension for Windows, macOS, and Linux. Select a word or short expression, confirm its surrounding sentence, choose guided or direct help, and save the encounter to the same library used by the web app.

## Connect the deployed app

The packaged extension defaults to [ContextBridge](https://contextbridge-newpoluton.vercel.app). After loading it in Chrome, choose **Connect to this server**, approve its host permission, then sign in on the website and paste a connection code from Settings. Both server and website addresses use the production origin.

## Run locally

1. Start the separate `web` project (`npm run dev` in that folder).
2. In this folder run `npm install`, then `npm run build`.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose this project's `dist` folder. Pin ContextBridge in the Chrome toolbar.
4. Open the extension's **Settings**. Set the server to `http://localhost:3000` and website to `http://localhost:5173` (the shipped package defaults to production). Choose **Connect to this server** and allow the requested server access.
5. Open the website, sign in (or use its explicitly labeled local demo), and create a one-time extension code in **Settings**. Paste the code into the extension. Codes expire after five minutes and are single-use; the resulting connection lasts up to 30 days and can be revoked with **Disconnect**.
6. On an ordinary webpage, select a short expression and click the toolbar icon, or use **Explore with ContextBridge** in the right-click menu. After activation, selecting text on that page also offers a small **Explore** button.

The server's keyless local demo supports these exact examples. It does not invent answers for other text:

- **addresses** — The proposal addresses the housing shortage by funding new construction.
- **take into account** — We need to take into account the needs of local residents.
- **nachhaltig** — Wir möchten unsere Stadt nachhaltig gestalten.

Choose English as the explanation language; the first two examples have English as their reading language, and the third has German. Set the OpenAI key in the web project to enable live AI for other selections.

## Features

- A native, browser-resizable side panel keeps the reading visible. Activating the extension also underlines visible reading words with a subtle highlight; new text is handled as the page changes. Tap a word or select a phrase to open a small in-page explanation overlay.
- Editable expression and context, explicit assistance choice, progressive clues, initial interpretation and feedback, reveal, optional revised interpretation, and an unresolved flag.
- Earlier saved encounters are offered for comparison beside the current sentence, with their meaning collapsed; they are not assumed to mean the same thing in a new sentence. The overlay’s save icon is active when the exact context and languages are already saved.
- An optional new-context check hides the explanation while attempting. Requests for hints/reveals and attempt order are recorded. Direct explanations are marked **Not attempted**, not incorrect.
- Light and dark appearance follow the system. An editable follow-up can be copied back to the original conversation; the learner reviews and sends it.
- Explicit save, searchable library, reopen and delete. Full spaced review and Anki export are available on the website.
- Shared chat history, Markdown formatting, code-copy buttons, and grammar follow-ups; custom AI instructions and learning preferences stay synchronized through the API.
- A bundled PDF reader with page navigation, zoom, selectable text, and an alternate reading-text view. Open it through **Open a PDF**. Documents stay on the device; only context explicitly submitted for help reaches the server.
- Session drafts survive panel reopening within the current browser session. They are not uploaded automatically.
- A manually refreshed daily AI-usage summary in Settings shows the shared request/token budget. Opening the extension, switching tabs, hints, and answer reveals do not generate extra AI requests. Only explicit exploration, feedback, chat, or saving new searchable context can request AI work; repeated requests can use the server's cache.

## Browser boundaries

Chrome's built-in PDF viewer, browser settings, Chrome Web Store pages, and some embedded cross-origin frames cannot be injected into. Use the bundled PDF reader for local PDFs, or enter the expression and sentence manually. Scanned PDFs require OCR, which is not included. This version targets Chrome 121+ and has not been adapted to Firefox's sidebar API. The first release supports desktop Chrome on all three operating systems; mobile Chrome does not install desktop extensions.

Underlines are activated only on the page where you invoke the extension. They use browser highlights rather than rewriting page text. Highlighting and tapping perform no AI lookup: the overlay asks you to confirm the expression, sentence, and assistance choice first. Only visible reading text and nearby scroll regions are highlighted, and the highlights update as you scroll. Browser controls, editable fields, links, and code are not intercepted.

## API keys and environment files

Both `.env` and `.env.example` exist. `.env` is ignored by Git and never copied to `dist` or the ZIP archive.

```dotenv
CONTEXTBRIDGE_API_URL=https://contextbridge-newpoluton.vercel.app
CONTEXTBRIDGE_WEB_URL=https://contextbridge-newpoluton.vercel.app
OPENAI_API_KEY=
```

The OpenAI variable in this project is deliberately unused. Put the real key in **the web project's `.env`**. Every browser-extension file is inspectable by its user; a bundled key would not be private. The extension authenticates to the web API with a revocable, user-scoped token, and only the server calls OpenAI. Its token is stored in `chrome.storage.local`, restricted to trusted extension pages, and is never sent to webpage scripts.

Only the two explicitly public URL variables are read by the build. Rebuild after changing their defaults, or change server and website addresses in the extension's Settings without rebuilding. Production addresses must use HTTPS.

## Connect a deployed website

1. Deploy the web app and configure its server-side credentials using that project's deployment workflow.
2. In `chrome://extensions`, copy ContextBridge's extension ID. Add that ID to the web server's `EXTENSION_IDS` environment variable (comma-separated if more than one) and redeploy. Local demo mode permits local Chrome extension origins automatically; production requires the explicit allowlist.
3. Set both extension addresses to the HTTPS website origin and choose **Connect to this server**. Approve its host permission, then sign in on the website and pair a fresh code.

This package includes a fixed public manifest key, so its unpacked ID remains **dfpafpdmlhafhpknaijeeelhdpbkiogk** across install locations and operating systems. No private signing key is shipped. If a future Chrome Web Store listing receives a different key/ID, update the server allowlist for that release.

## Checks and packaging

```sh
npm run check
npm run build
npm test
npm run package
```

The checks cover selected-occurrence extraction, short phrases, non-Latin punctuation, context limits, origin validation, exact-context saved state, assistance chronology, and packaged-credential exclusion. Browser integration was also checked with the real MV3 worker, page overlay, content-script capture, scoped-message rejection, pairing, saving, chats, local PDFs, and draft restoration. Native optional-permission approval was pre-granted only in the automated test fixture. `npm run package` produces `releases/contextbridge-extension.zip` with the manifest at its root. Unzip it and load the extracted directory for manual testing. The ZIP is also the source package for a future Chrome Web Store submission; this task does not publish a store listing.

The build bundles PDF.js and all its worker/font/CMap/WASM assets locally, along with its license. No remotely hosted extension code or third-party fonts are loaded.

## Design references

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [PDF.js](https://mozilla.github.io/pdf.js/)
