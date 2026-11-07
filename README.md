<p align="center">
  <img src=".github/assets/contextbridge.svg" alt="ContextBridge icon" width="72" height="72" />
</p>

<h1 align="center">ContextBridge · Browser Extension</h1>

<p align="center">A little context. A world of possibility.<br />Language learning, right beside the words you read.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=flat&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome Manifest V3" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&amp;logo=typescript&amp;logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PDF.js-Bundled_reader-E85D3F?style=flat" alt="Bundled PDF.js reader" />
  <img src="https://img.shields.io/badge/API_keys-Server_only-386A59?style=flat" alt="API keys remain on the server" />
</p>

<p align="center">
  <a href="https://contextbridge-newpoluton.vercel.app">🌐 Open the app</a> ·
  <a href="https://contextbridge-newpoluton.vercel.app/downloads/contextbridge-extension.zip">📦 Download extension</a> ·
  <a href="https://github.com/newpoluton-alt/contextbridge-web">↗ Web repository</a>
</p>

A Chrome Manifest V3 extension for Windows, macOS, and Linux. Select a word or short expression, confirm its surrounding sentence, choose guided or direct help, and save the encounter to the same library used by the web app.

## 🔗 Connect the deployed app

The packaged extension defaults to [ContextBridge](https://contextbridge-newpoluton.vercel.app). Open it and choose **Connect account**. Approve Chrome’s website-access prompt if it appears, then sign in or create an account on the website. The connection finishes automatically. The extension shows **Signed in** and your email, and the Connect button disappears.

Signing out on the website also signs out this browser’s connected extension. You can also choose **Sign out of extension** in its account card. When the connection expires, **Connect account** returns. A temporary internet outage keeps the existing account connected and shows an offline message.

For an existing unpacked installation, download the updated ZIP, replace the files in the folder you originally loaded, and click **Reload** for ContextBridge in `chrome://extensions`. The extension keeps its stable ID and recognizes existing connected accounts.

## ⚡ Run locally

1. Start the separate `web` project (`npm run dev` in that folder).
2. In this folder run `npm install`. Set `CONTEXTBRIDGE_API_URL=http://localhost:3000` and `CONTEXTBRIDGE_WEB_URL=http://localhost:5173` in the ignored `.env`, then run `npm run build`.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose this project's `dist` folder. Pin ContextBridge in the Chrome toolbar.
4. Choose **Connect account** in the extension and approve the requested website access.
5. Sign in on the website (or use its explicitly labeled local demo). The extension connects automatically, then displays the connected account. Behind the scenes, the website supplies a single-use code that expires after five minutes. The extension exchanges it for its own account-scoped token, which lasts up to 30 days. Users never need to copy a code or enter server addresses.
6. On an ordinary webpage, select a short expression and click the toolbar icon, or use **Explore with ContextBridge** in the right-click menu. After activation, selecting text on that page also offers a small **Explore** button.

The server's keyless local demo supports these exact examples. It does not invent answers for other text:

- **addresses** — The proposal addresses the housing shortage by funding new construction.
- **take into account** — We need to take into account the needs of local residents.
- **nachhaltig** — Wir möchten unsere Stadt nachhaltig gestalten.

Choose English as the explanation language; the first two examples have English as their reading language, and the third has German. Set the OpenAI key in the web project to enable live AI for other selections.

## ✨ Features

- A native, browser-resizable side panel keeps the reading visible. Activating the extension also underlines visible reading words with a subtle highlight; new text is handled as the page changes. Tap a word or select a phrase to open a small in-page explanation overlay.
- Editable expression and context, explicit assistance choice, progressive clues, initial interpretation and feedback, reveal, optional revised interpretation, and an unresolved flag.
- Earlier saved encounters are offered for comparison beside the current sentence, with their meaning collapsed; they are not assumed to mean the same thing in a new sentence. The overlay’s save icon is active when the exact context and languages are already saved.
- An optional new-context check hides the explanation while attempting. The new-context check has separate clue and answer-reveal controls. Requests for hints/reveals and attempt order are recorded. Direct explanations are marked **Not attempted**, not incorrect.
- Light and dark appearance follow the system. An editable follow-up can be copied back to the original conversation; the learner reviews and sends it.
- Explicit save, searchable library, reopen and delete. Full spaced review and Anki export are available on the website.
- Shared chat history, Markdown formatting, code-copy buttons, and grammar follow-ups; custom AI instructions and learning preferences stay synchronized through the API.
- A bundled PDF reader with page navigation, zoom, selectable text, and an alternate reading-text view. Open it through **Open a PDF**. Documents stay on the device; only context explicitly submitted for help reaches the server.
- Session drafts survive panel reopening within the current browser session. They are not uploaded automatically.
- A manually refreshed daily AI-usage summary in Settings shows the shared request/token budget. Opening the extension, switching tabs, hints, and answer reveals do not generate extra AI requests. Only explicit exploration, feedback, chat, or saving new searchable context can request AI work; repeated requests can use the server's cache.

## 🧭 Browser boundaries

Chrome's built-in PDF viewer, browser settings, Chrome Web Store pages, and some embedded cross-origin frames cannot be injected into. Use the bundled PDF reader for local PDFs, or enter the expression and sentence manually. Scanned PDFs require OCR, which is not included. This version targets Chrome 121+ and has not been adapted to Firefox's sidebar API. The first release supports desktop Chrome on all three operating systems; mobile Chrome does not install desktop extensions.

Underlines are activated only on the page where you invoke the extension. They use browser highlights rather than rewriting page text. Highlighting and tapping perform no AI lookup: the overlay asks you to confirm the expression, sentence, and assistance choice first. Only visible reading text and nearby scroll regions are highlighted, and the highlights update as you scroll. Browser controls, editable fields, links, and code are not intercepted.

## 🔐 API keys and environment files

Both `.env` and `.env.example` exist. `.env` is ignored by Git and never copied to `dist` or the ZIP archive.

```dotenv
CONTEXTBRIDGE_API_URL=https://contextbridge-newpoluton.vercel.app
CONTEXTBRIDGE_WEB_URL=https://contextbridge-newpoluton.vercel.app
OPENAI_API_KEY=
```

The OpenAI variable in this project is deliberately unused. Put the real key in **the web project's `.env`**. Every browser-extension file is inspectable by its user; a bundled key would not be private. The extension authenticates to the web API with a revocable, user-scoped token, and only the server calls OpenAI. Its token is stored in `chrome.storage.local`, restricted to trusted extension pages, and is never sent to webpage scripts.

Automatic website pairing accepts only the exact production origin and the exact local development origins on port 5173. Its server destination is fixed by the extension, never supplied by a webpage. Pairing messages contain only the one-time code and the expected account ID. The extension verifies the identity before connecting. Status and sign-out messages are scoped to the expected account and never return identity details or tokens to the website. Signing out cancels an unfinished connection for that account. Pairing and sign-out clear prior-account drafts, chats, and overlays, and late requests cannot restore a previous account. Unsaved preference edits survive focus changes, and saving sends only the fields you changed.

Only the two explicitly public URL variables are read by the build. Rebuild after changing these defaults. Production addresses must use HTTPS. The normal account flow has no server fields or connection codes.

## 🌐 Connect a deployed website

1. Deploy the web app and configure its server-side credentials using that project's deployment workflow.
2. In `chrome://extensions`, copy ContextBridge's extension ID. Add that ID to the web server's `EXTENSION_IDS` environment variable (comma-separated if more than one) and redeploy. Local demo mode permits local Chrome extension origins automatically; production requires the explicit allowlist.
3. Set the extension’s public `.env` URLs to the HTTPS website origin before building. For a separately hosted website, update the exact trusted origins in `src/pairing.ts` and `public/manifest.json`, and the extension ID in the website bridge if needed. Load the build, choose **Connect account**, approve website access, and sign in.

This package includes a fixed public manifest key, so its unpacked ID remains **dfpafpdmlhafhpknaijeeelhdpbkiogk** across install locations and operating systems. No private signing key is shipped. If a future Chrome Web Store listing receives a different key/ID, update the server allowlist for that release.

## 📦 Checks and packaging

```sh
npm run check
npm run build
npm test
npm run package
```

The checks cover selected-occurrence extraction, short phrases, non-Latin punctuation, context limits, origin validation, exact-context saved state, assistance chronology, and packaged-credential exclusion. Worker regressions cover account-scoped status/sign-out, signing out during a pending connection, stale responses after switching accounts, expired tokens, offline recovery, revoked website permission, and connection after permission approval. Browser integration was also checked with the real MV3 worker, page overlay, content-script capture, scoped-message rejection, pairing, saving, chats, local PDFs, and draft restoration. Native optional-permission approval was pre-granted only in the automated test fixture. `npm run package` produces `releases/contextbridge-extension.zip` with the manifest at its root. Unzip it and load the extracted directory for manual testing. The ZIP is also the source package for a future Chrome Web Store submission; this task does not publish a store listing.

The build bundles PDF.js and all its worker/font/CMap/WASM assets locally, along with its license. No remotely hosted extension code or third-party fonts are loaded.

## 📚 Design references

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [PDF.js](https://mozilla.github.io/pdf.js/)
