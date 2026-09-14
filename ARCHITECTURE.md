# Architecture notes

## Standalone deployment model

The application is intentionally separate from the ChurchTools installation.

```text
Cloudflare Pages
├── Vite/React static application
└── Pages Function: /ct-proxy/*
                         │
                         └── https://nl.church.tools/*
```

The browser never calls `nl.church.tools` directly in production. It sends same-origin requests to the Pages Function, which forwards them server-side. This avoids browser CORS requirements while keeping ChurchTools as the system of record.

The proxy is constrained to the fixed upstream origin `https://nl.church.tools` and requires an `Authorization: Login …` header on every request.

## API mapping

The frontend uses these ChurchTools REST resources from the supplied OpenAPI document:

| UI action | Browser request | Upstream ChurchTools request |
|---|---|---|
| Load songs | `GET /ct-proxy/api/songs?...` | `GET https://nl.church.tools/api/songs?...` |
| Refresh arrangements | `GET /ct-proxy/api/songs/{songId}/arrangements` | `GET /api/songs/{songId}/arrangements` |
| Load arrangement files | `GET /ct-proxy/api/files/song_arrangement/{arrangementId}` | `GET /api/files/song_arrangement/{arrangementId}` |
| Download SonBeamer file | `GET /ct-proxy/<fileUrl path>` | `GET https://nl.church.tools/<fileUrl path>` |
| Upload replacement | `POST /ct-proxy/api/files/song_arrangement/{arrangementId}` | `POST /api/files/song_arrangement/{arrangementId}` |
| Remove previous file | `DELETE /ct-proxy/api/files/{fileId}` | `DELETE /api/files/{fileId}` |

The arrangement response itself contains a `files` array, but the generic file endpoint is used because it returns the file `id` needed for precise deletion.

## Authentication boundary

The independent site cannot rely on a ChurchTools same-origin session cookie. Authentication therefore uses a ChurchTools Login Token entered by the user.

- The token is stored in browser `sessionStorage` only.
- The browser sends it to `/ct-proxy/*` as `Authorization: Login <token>`.
- The Pages Function forwards that authorization header to `nl.church.tools`.
- The Function does not persist the token and does not require a Cloudflare secret.
- `Set-Cookie` headers from ChurchTools are removed before the response is returned to the frontend.

## Cloudflare Pages routing

`functions/ct-proxy/[[path]].js` implements the proxy using Pages Functions file-based routing.

`public/_routes.json` is copied into `dist/_routes.json` by Vite and restricts Function invocation to:

```text
/ct-proxy/*
```

All generated JS/CSS/HTML files therefore remain normal static Pages assets.

For local Vite development, `vite.config.ts` provides the equivalent `/ct-proxy` reverse proxy. `npm run pages:dev` runs the real Pages Function through Wrangler.

## Replacement transaction

There is no single REST operation in the supplied specification that atomically replaces an arrangement file. The implementation therefore uses this sequence:

1. Read the current file list.
2. Serialize the edited `.sng` in memory.
3. Upload the new file.
4. Only after a successful upload, delete the prior `.sng` file IDs.
5. Leave all non-`.sng` arrangement files untouched.

This can leave duplicate `.sng` files if cleanup fails, but does not delete the working version before a replacement exists.

## SonBeamer document model

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

The parser intentionally preserves all header lines instead of regenerating only known fields. The editor changes only the body and `#VerseOrder=`. Unknown metadata therefore survives saves.

For multilingual files, the preview interprets `#LangCount=N` as `N` alternating lyric lines per translation group. The raw lyrics editor remains source-of-truth, so no multilingual content is reordered during parsing or serialization.
