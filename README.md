# ChurchTools SonBeamer Song Editor

Standalone React + TypeScript frontend for browsing the song library at **nl.church.tools**, selecting arrangements, downloading `.sng` files, editing lyrics/slide boundaries and verse order, previewing slides, and replacing the arrangement's SonBeamer file.

The application is designed to be hosted independently from ChurchTools. Cloudflare Pages serves the static frontend and a small Pages Function proxies authenticated requests to `https://nl.church.tools`, so the browser does not depend on ChurchTools CORS settings.

## Request flow

```text
Browser
  │ same-origin request + Authorization: Login <token>
  ▼
Cloudflare Pages /ct-proxy/*
  │ server-side proxy
  ▼
https://nl.church.tools/*
```

The proxy target is fixed in `functions/ct-proxy/[[path]].js`; it is not a general-purpose arbitrary-host proxy.

## ChurchTools workflow

1. `GET https://nl.church.tools/api/songs?include=arrangements&…` loads the song library through `/ct-proxy/api/songs`.
2. Selecting a song refreshes arrangements from `/api/songs/{songId}/arrangements`.
3. Selecting an arrangement loads files from `/api/files/song_arrangement/{arrangementId}` and chooses the newest `.sng` file.
4. The returned `fileUrl` is validated to belong to `https://nl.church.tools` and downloaded through `/ct-proxy/...`.
5. Save serializes a new `.sng`, uploads it with `POST /api/files/song_arrangement/{arrangementId}`, then deletes the previous `.sng` files with `DELETE /api/files/{id}` only after the upload succeeds.

The upload-first sequence deliberately favors data safety. If cleanup fails, ChurchTools can temporarily contain more than one `.sng` file, but the new file is not lost.

## Authentication

Because the app is hosted independently of ChurchTools, it uses a ChurchTools Login Token rather than relying on ChurchTools browser cookies.

The user enters the token in the UI. The frontend stores it in `sessionStorage`, sends it only to the same-origin `/ct-proxy/*` route, and the Pages Function forwards it to `nl.church.tools` as:

```text
Authorization: Login <token>
```

The token is not compiled into the site, stored in Cloudflare configuration, or written to persistent browser storage by this application.

## SonBeamer behavior

- Existing metadata lines are preserved.
- `#VerseOrder=` is updated from the editable list.
- UTF-8 BOM and LF/CRLF line endings are preserved from the source file.
- Slides are separated by a line containing `---`.
- The first non-empty line in each slide block is treated as the slide/verse label.
- `#LangCount=N` controls multilingual preview. For `N > 1`, non-empty lyric lines are displayed as alternating language lines in groups of `N`.

## Local development

With Nix installed and flakes enabled, enter the development shell, install the
locked dependencies, and run Vite:

```bash
nix develop
npm ci
npm run dev
```

The flake provides Node.js 24 (including npm), Git, and the `workerd` runtime.
It supports x86-64/ARM64 Linux and Apple Silicon macOS.
Vite, TypeScript, and Wrangler are installed by `npm ci`. The shell points
Wrangler at a Nix-patched runtime matching `package-lock.json` so local Pages
Functions work on NixOS. `flake.lock` pins the Nix tools and
`package-lock.json` pins the JavaScript dependencies. Without Nix, install
Node.js 24 and run the same npm commands.

To check the production build from the development environment:

```bash
nix develop --command npm run build
```

For fast local development, Vite proxies `/ct-proxy/*` directly to `https://nl.church.tools` using the same URL layout as production.

To test the actual Cloudflare Pages Function locally:

```bash
npm run pages:dev
```

That command builds the frontend and starts `wrangler pages dev` using `wrangler.jsonc`.

## Deploy to Cloudflare Pages

### Option 1: Git integration

Push this directory to GitHub or GitLab, create a Cloudflare Pages project from the repository, and use:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** repository root

Keep the `functions/` directory at the repository root. Cloudflare detects Pages Functions from that directory. `public/_routes.json` ensures only `/ct-proxy/*` invokes the Function; static asset requests remain static.

No environment variables or secrets are required for the default `nl.church.tools` deployment.

### Option 2: Wrangler

Authenticate Wrangler once. On the first deployment, create the Pages project if it does not already exist, then deploy:

```bash
npx wrangler login
npx wrangler pages project create churchtools-song-editor
npm run deploy
```

For later deployments, only `npm run deploy` is needed.

`wrangler.jsonc` contains the Pages project name, output directory, and compatibility date. If you create the Pages project with a different name, update the `name` value before deployment.

## Production notes

- The proxy rejects requests without a `Login` authorization header.
- The upstream host is hardcoded to `https://nl.church.tools`.
- Proxy responses are marked `Cache-Control: no-store` and `Set-Cookie` is stripped.
- Static security headers are defined in `public/_headers`.
- If an arrangement has multiple `.sng` files, the editor opens the newest file by `meta.modifiedDate`/`meta.createdDate`, falling back to the highest file ID.
- Save removes all previous `.sng` files for that arrangement after the replacement upload succeeds; non-`.sng` files are untouched.
- If a verse-order item references a missing slide label, the editor shows a warning and omits that missing item from the preview.
