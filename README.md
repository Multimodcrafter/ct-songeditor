# ChurchTools SongBeamer Song Editor

Standalone React + TypeScript frontend for browsing the song library at **nl.church.tools**, selecting arrangements, downloading `.sng` files, editing lyrics/slide boundaries and verse order, previewing slides, and replacing the arrangement's SongBeamer file.

The application is designed to be hosted independently from ChurchTools. Cloudflare Pages serves the static frontend and a small Pages Function proxies authenticated requests to `https://nl.church.tools`, so the browser does not depend on ChurchTools CORS settings.

## Request flow

```text
Browser
  │ same-origin request + encrypted HttpOnly session cookie
  ▼
Cloudflare Pages /ct-proxy/*
  │ server-side proxy + Authorization: Bearer <access_token>
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

The German UI offers **Mit ChurchTools anmelden**. The Pages Functions run an
OAuth authorization-code flow against `https://nl.church.tools/oauth/authorize`
and `/oauth/access_token`, requesting the `api` scope. API access through OAuth
requires ChurchTools **3.135 or later**. See the
[ChurchTools release announcement](https://blog.church.tools/blog/v3-135-formatieren-erwaehnen-neue-wiki-suche-und-gruppen-verbesserungen/).

Login state and a PKCE verifier are generated on the server. The callback validates
the state and redirect URI before exchanging the code. Access tokens are kept in
an AES-GCM encrypted `HttpOnly`, `SameSite=Lax` cookie (`Secure` on HTTPS), and the
proxy forwards them as `Authorization: Bearer <access_token>`. No credentials are
exposed to frontend JavaScript. Mutating routes require the same-origin `Origin`
header; upstream cookies are stripped and cross-origin redirects are rejected.

Sessions expire with the access token, after at most eight hours. The user is
prompted to log in again when the session expires; tokens are not refreshed
automatically. **Abmelden** clears the editor's session, leaving the ChurchTools
website login unchanged.

### One-time OAuth setup

1. In `nl.church.tools`, open **Systemeinstellungen → Login** and add an OAuth
   client named **SongBeamer-Liededitor**. Copy its client identifier.
2. Register each exact callback URL you use:
   - `http://localhost:5173/auth/callback` for `npm run dev`;
   - `http://localhost:8788/auth/callback` for `npm run pages:dev`;
   - `https://<your-editor-domain>/auth/callback` for production.
   Use `localhost` consistently locally; `127.0.0.1` is a different origin.
3. Grant the intended users **Über ChurchTools-Konto in Drittsystem einloggen**
   (`Login to External System`) for this client, along with the ChurchTools song
   and arrangement-file permissions they need.
4. Set `CHURCHTOOLS_CLIENT_ID` and `SESSION_SECRET` for the Pages Functions.
   `SESSION_SECRET` must contain at least 32 random characters. Generate one with:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

5. `CHURCHTOOLS_CLIENT_SECRET` is optional. Set it only if configured for this
   client; it is used exclusively in the server-side token exchange. ChurchTools
   currently does not require a client secret. See the
   [official OAuth setup guide](https://churchtools.academy/en/help/system-settings/oauth-login-systemsettings/oauth-authentication-with-churchtools/).

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the
values. `.dev.vars` is ignored by Git. In Cloudflare Pages, configure these values
in the project's runtime variables/secrets for the relevant environment; mark
`SESSION_SECRET` and any `CHURCHTOOLS_CLIENT_SECRET` as secrets. Do not prefix them
with `VITE_`. Restart the local development servers after changing `.dev.vars`.

Until configured, the editor shows that login is not yet available. Real login
requires the registered ChurchTools client; automated tests use a mocked provider.

## SongBeamer behavior

- Existing metadata lines are preserved.
- `#VerseOrder=` is updated from the editable list.
- UTF-8 BOM and LF/CRLF line endings are preserved from the source file.
- Slides are separated by a line containing `---`.
- Built-in SongBeamer verse markers such as `Vers 1`, `Verse 1`, `Refrain`, and
  `Chorus` label a slide. Custom labels use `$$M=Name`.
- Unmarked slides inherit the preceding marked slide's label without losing any
  lyric lines. Slides before the first marker remain unlabeled; they are shown in
  file order when no verse order is set, and otherwise produce a warning.
- Every occurrence of a label in the verse order expands **all** slides with that
  label in file order, including continuations. Repeated labels are valid.
- Verse-order dropdowns offer each available label once. References to removed
  labels remain visible as missing until changed or removed.
- Preview text is horizontally centered and aligned to the top of each slide.
- `#LangCount=N` controls multilingual preview. For `N > 1`, non-empty lyric lines are displayed as alternating language lines in groups of `N`.

## Local development

With Nix installed and flakes enabled, enter the development shell, install the
locked dependencies, and run Vite:

```bash
nix develop
npm ci
# Configure .dev.vars as described above, then:
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

`npm run dev` starts Vite at `http://localhost:5173` and Wrangler at port 8788.
Vite proxies `/auth/*` and `/ct-proxy/*` to the real Pages Functions, so local
development uses the same OAuth and session handling as production. React edits
use Vite's hot reload. Both processes stop together on Ctrl+C.

To test the actual Cloudflare Pages Function locally:

```bash
npm run pages:dev
```

That command builds the frontend and starts `wrangler pages dev` using `wrangler.jsonc`.
Open `http://localhost:8788` and use its registered callback URL. Do not run it
alongside `npm run dev`, which already uses port 8788.

Run the regression tests with `npm test`. `npm run preview` previews static build
assets only; use one of the commands above for authentication and API requests.

## Deploy to Cloudflare Pages

### Option 1: Git integration

Push this directory to GitHub or GitLab, create a Cloudflare Pages project from the repository, and use:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** repository root

Keep the `functions/` and `server/` directories at the repository root. Cloudflare
detects Pages Functions from `functions/`. `public/_routes.json` routes `/auth/*`
and `/ct-proxy/*` to Functions; static asset requests remain static.

Configure the OAuth runtime variables/secrets and production callback URI before
using login, as described above.

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

- The proxy rejects requests without a valid encrypted session cookie.
- The upstream host is hardcoded to `https://nl.church.tools`.
- Proxy responses are marked `Cache-Control: no-store` and `Set-Cookie` is stripped.
- Static security headers are defined in `public/_headers`.
- If an arrangement has multiple `.sng` files, the editor opens the newest file by `meta.modifiedDate`/`meta.createdDate`, falling back to the highest file ID.
- Save removes all previous `.sng` files for that arrangement after the replacement upload succeeds; non-`.sng` files are untouched.
- If a verse-order item references a missing slide label, the editor shows a warning and omits that missing item from the preview.
