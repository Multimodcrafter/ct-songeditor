# Architecture notes

## Standalone deployment model

The application is intentionally separate from the ChurchTools installation.

```text
Cloudflare Pages
├── Vite/React static application
├── Pages Functions: /auth/* (OAuth + session)
└── Pages Function: /ct-proxy/*
                         │
                         └── https://nl.church.tools/*
```

The browser never calls `nl.church.tools` directly in production. It sends same-origin requests to the Pages Function, which forwards them server-side. This avoids browser CORS requirements while keeping ChurchTools as the system of record.

The proxy is constrained to the fixed upstream origin `https://nl.church.tools`
and requires an encrypted session cookie on every request. It attaches the OAuth
access token server-side as `Authorization: Bearer …`.

## API mapping

The frontend uses these ChurchTools REST resources from the supplied OpenAPI document:

| UI action | Browser request | Upstream ChurchTools request |
|---|---|---|
| Load songs | `GET /ct-proxy/api/songs?...` | `GET https://nl.church.tools/api/songs?...` |
| Refresh arrangements | `GET /ct-proxy/api/songs/{songId}/arrangements` | `GET /api/songs/{songId}/arrangements` |
| Load arrangement files | `GET /ct-proxy/api/files/song_arrangement/{arrangementId}` | `GET /api/files/song_arrangement/{arrangementId}` |
| Download SongBeamer file | `GET /ct-proxy/<fileUrl path>` | `GET https://nl.church.tools/<fileUrl path>` |
| Upload replacement | `POST /ct-proxy/api/files/song_arrangement/{arrangementId}` | `POST /api/files/song_arrangement/{arrangementId}` |
| Remove previous file | `DELETE /ct-proxy/api/files/{fileId}` | `DELETE /api/files/{fileId}` |

The arrangement response itself contains a `files` array, but the generic file endpoint is used because it returns the file `id` needed for precise deletion.

## Authentication boundary

`functions/auth/[[action]].js` implements the authorization-code flow with scope
`api` (ChurchTools 3.135+):

1. `POST /auth/login` creates random state and a PKCE verifier in a ten-minute
   encrypted HttpOnly cookie and returns the ChurchTools authorization URL.
2. `GET /auth/callback` validates state, expiry, and redirect URI, then exchanges
   the code server-side. The transient login cookie is cleared on success/failure.
3. The access token is encrypted with AES-GCM in an HttpOnly, SameSite=Lax cookie
   (Secure on HTTPS). Its expiry is capped at eight hours and the token lifetime.
4. `GET /auth/session` exposes only authentication/configuration booleans.
5. `POST /auth/logout` clears both cookies. An expired or revoked token requires
   another login; no automatic refresh or global ChurchTools logout is performed.

`server/session.js` holds shared cookie and cryptography helpers. The encryption
key is derived from server-only `SESSION_SECRET`; it is never built into Vite's
assets. `CHURCHTOOLS_CLIENT_ID` identifies the registered client, and optional
`CHURCHTOOLS_CLIENT_SECRET` is used only in the token exchange. No database is needed.

All mutating application requests must carry a matching Origin header. The proxy
ignores browser-supplied Authorization headers, removes upstream Set-Cookie, and
follows download redirects only within the fixed ChurchTools origin. Tokens are
never returned in a JSON response or URL. See README for provider registration.

## Cloudflare Pages routing

`functions/ct-proxy/[[path]].js` implements the proxy using Pages Functions file-based routing.

`public/_routes.json` is copied into `dist/_routes.json` by Vite and restricts Function invocation to:

```text
/ct-proxy/*
/auth/*
```

All generated JS/CSS/HTML files therefore remain normal static Pages assets.

`npm run dev` starts Vite and Wrangler together using `scripts/dev.mjs`.
Vite proxies both dynamic routes to Wrangler, preserving the original Host and
Origin so cookies and callbacks belong to the frontend origin. `npm run pages:dev`
serves the production build and Functions directly through Wrangler.

## Replacement transaction

There is no single REST operation in the supplied specification that atomically replaces an arrangement file. The implementation therefore uses this sequence:

1. Read the current file list.
2. Serialize the edited `.sng` in memory.
3. Upload the new file.
4. Only after a successful upload, delete the prior `.sng` file IDs.
5. Leave all non-`.sng` arrangement files untouched.

This can leave duplicate `.sng` files if cleanup fails, but does not delete the working version before a replacement exists.

## SongBeamer document model

The supplied sample file establishes this structure:

```text
#LangCount=1
#Title=...
#VerseOrder=Verse 1,Chorus 1,...
---
Verse 1
lyrics...
---
Chorus 1
lyrics...
```

`src/lib/songbeamer.ts` preserves all header lines instead of regenerating only
known fields. The editor changes only the body and `#VerseOrder=`. Unknown metadata
therefore survives saves, along with the source BOM and line endings.

Only SongBeamer verse markers or `$$M=...` custom markers are labels. Unmarked
slides inherit the preceding label and retain all their lyrics. The preview groups
slides by effective label and expands the entire group for every occurrence in
the verse order. An empty verse order displays all slides in file order. Leading
unmarked slides have no label and are omitted with a warning when an order is set.
The dropdown choices are the distinct nonempty effective labels.

Marker syntax and continuation behavior follow the
[SongBeamer wiki](https://wiki.songbeamer.de/index.php?title=Song) and the
[developer's explanation of the SNG format](https://forum.songbeamer.de/viewtopic.php?t=4657).

For multilingual files, the preview interprets `#LangCount=N` as `N` alternating lyric lines per translation group. The raw lyrics editor remains source-of-truth, so no multilingual content is reordered during parsing or serialization.
