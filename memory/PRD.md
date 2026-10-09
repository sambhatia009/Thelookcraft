# TheLookCraft (formerly StyleVault) — PRD

## Original Problem Statement
Build "StyleVault", a mobile-first AI Personal Stylist & Virtual Wardrobe app. Users upload photos of clothes/shoes/accessories; the app auto-categorizes and tags them into a digital closet. Users ask an AI stylist to build outfits for occasions or to match a specific piece. Clean, high-end editorial aesthetic (SSENSE/Farfetch), light & dark mode, 4-tab bottom nav (Closet, Stylist, Lookbook, Profile), FAB upload with background-removal styling and auto-tags, AI chat with quick prompts + item attachment, outfit composite cards with a Stylist Note, save/try-another actions, and profile personalization.

## Architecture
- **Frontend:** Expo React Native (expo-router file routing), react-query, react-native-reanimated, expo-image, phosphor icons. Monochrome brutalist theme (light+dark) in `src/theme.ts`.
- **Backend:** FastAPI + MongoDB (motor). Bearer session tokens (7-day) in `user_sessions`.
- **AI:** Gemini 3 Flash for vision tags, Gemini 3.1 Pro for stylist outfits, Gemini 3.1 Flash Image for try-on via the existing emergentintegrations configuration.
- **Storage:** Emergent Managed Object Storage for uploaded clothing cutouts; served via `/api/files/{path}` with per-user ownership check.
- **Background removal:** `rembg` (u2net) produces transparent PNG cutouts on upload.

## User Personas
- Style-conscious individual who wants to organize their wardrobe and get outfit ideas.
- Busy professional needing quick occasion-based outfit suggestions from clothes they already own.

## Core Requirements (static)
- Auth: email/password + Emergent Google login.
- Digital closet with category filters (Tops, Bottoms, Outerwear, Shoes, Accessories).
- Photo upload → AI auto-tag + background removal → editable tags before save.
- AI stylist chat: quick prompts, attach an item to "match", composite outfit cards + Stylist Note.
- Saved outfits lookbook.
- Profile: dress code, weather context, color palette preferences.

## Implemented (2026-06)
- Email/password + Google auth, session gate, auto-seeded 5 mock wardrobe items on signup.
- Closet grid with sticky category filter chips, item detail screen, soft delete.
- Add Item flow: camera/gallery (permission-handled) → Gemini vision tagging + rembg cutout stored in object storage → editable tag form.
- AI Stylist: quick prompt chips, item attach picker, Gemini-generated outfit (validated item IDs), Stylist Note, missing-item suggestion, Save Outfit / Try Another / Add Missing.
- Lookbook feed of saved outfits with delete.
- Profile with wardrobe stats + editable dress code / weather / color palette.
- Light & dark theme (device-driven). File-ownership enforced on image reads.
- Verified: 12/12 backend pytest + full frontend e2e pass.

## Added (2026-06, iteration 2)
- **Weather Sync:** Stylist header "Enable Weather" chip requests location (permission-handled), fetches live temperature + conditions via Open-Meteo (no key), and passes it to the AI so picks match the day's temperature/layering.
- **Shop The Gap:** the AI's missing-item suggestion is now a tappable "SHOP THE GAP" button that opens a shopping search for that exact item.
- **Outfit Share Card:** every saved look has a Share button that renders an editorial, watermarked image (react-native-view-shot) and opens the native share sheet (downloads on web).

## Added (2026-06, iteration 3)
- **Weather Auto-Refresh:** weather preference persisted (`sv_weather_enabled`); once enabled the chip auto-syncs on open (no re-prompt), refreshes every 15 min and on app foreground; chip toggles sync off.
- **Save To Photos:** Lookbook SAVE action captures the editorial card and writes it to the camera roll via `expo-media-library` (add-only permission, Open Settings toast action when blocked). Web downloads the PNG.
- **Occasion Tags:** saving a look opens an OccasionSheet (Work/Date/Travel/Casual/Event + custom text). Lookbook shows filter chips (All / used tags / Untagged), a tag badge on the card, and ADD/EDIT TAG. `PATCH /api/outfits/{id}`.
- **Wardrobe Insights:** Profile "WARDROBE INSIGHTS" — wears logged / saved looks / never worn KPIs, MOST WORN (wear_count×2 + outfit appearances), color balance bar + legend, category balance. Wear logging via "WORE IT TODAY" (item detail, `POST /api/items/{id}/wear`) and Lookbook WEAR (`POST /api/outfits/{id}/wear`). `GET /api/insights`.
- Verified: 19/19 backend pytest + frontend e2e pass (testing agent iteration 2 + manual Save-to-Photos web check).

## Added (2026-06, iteration 4)
- **Bulk Upload:** gallery multi-select (≤10); sequential analyse with progress (`src/components/bulk-review.tsx`); per-row compact editor; retry/remove; "Save N to Closet". Shared `src/components/item-editor.tsx` (also used by single add + item edit).
- **Item editing:** item detail EDIT → full editor incl. NOTES/DESCRIPTION (`notes`); "Don't suggest in looks" switch (`preference: avoid|neutral`, hidden from stylist).
- **Never-Worn Nudges:** Stylist empty-state nudge (insights.never_worn_count) → prompt with `prefer_unworn`; wardrobe JSON sent to Gemini carries `never_worn`/`times_worn`/`notes`.
- **Outfit Feedback:** 👍/👎 per look → `POST /api/stylist/feedback`; 👎 auto "Try another"; taste summary (liked/disliked combos, rejected/approved pieces, banned pieces) injected into every stylist prompt; `GET /api/stylist/taste`. Piece action sheet: swap / remove / "Don't suggest this again" (with Undo).
- **Gemini models:** stylist → `gemini-3.1-pro-preview`; tagging stays `gemini-3-flash-preview`; try-on → `gemini-3.1-flash-image-preview` (Nano Banana).
- **Visualise on me:** Profile "ABOUT YOU" (gender, age, full-body photo → `POST /api/profile/photo`, private storage); result card "VISUALISE ON ME" → `POST /api/stylist/visualize` composes user photo + garment references → editorial try-on image, cached per item-set, invalidated on photo change.
- Verified: 20/20 backend pytest + frontend e2e (testing agent iteration 6) + manual 👎/visualise flows.

## Added — Lookbook Try-On (verified)
- Saved outfits support a private `visualization_path`. `POST /api/outfits/{id}/visualize` generates/reuses a real try-on and saves it to the existing outfit.
- Lookbook offers Visualise on me, generation progress, retry and missing-photo navigation. The uncropped render is inside the share card and Save To Photos capture, with loading guards.
- Stylist Save Try-On stores image + look together. Visualising an already-saved result enables updating that same Lookbook entry (no duplicate); editing pieces clears the obsolete render.
- Backend validates image ownership and exact item-set match. Cache keys include the Profile photo; saved outfit images remain after photo replacement/removal.
- New shared component: `src/components/try-on-preview.tsx` (native capture-safe image, loading/error retry). Existing no-render cards remain supported.
- Verified: backend 9/9 (iteration 7); frontend iteration 8 confirms both Stylist save orders, no duplicate on save-first, occasion persistence, edit invalidation, re-login persistence, image retry without regeneration, and visually inspected 390×1027 share/save PNGs containing the full render/title/note/AI label/watermark.
- Final manual follow-up confirms no-render Share/Save, tag editing, wear logging and deletion all pass. Older render reported with a transient fetch error returned 200/image content on 3/3 normal reads; error/retry UI is tested. See `test_reports/iteration_8_followup.json`.
- Fixed during verification: stable React Native Image callbacks/source plus readiness no-op guard prevent render loops; native/web image-load dimension payloads handled separately without cropping.

## Backlog (prioritized)
- **P0:** none outstanding for the Lookbook try-on feature.
- **P0 — health-check tooling:** automated readiness check still reports FAIL for missing Expo `--tunnel` in readonly platform Supervisor config. Troubleshooting and platform support identify this as a managed-proxy false positive; platform health-check correction is required. Do not add ngrok or edit readonly Supervisor configuration merely to satisfy this check.
- **P1:** calendar/outfit planner; wear history timeline.
- **P2:** cost-per-wear; optional render-only share card layout.

## Next Tasks
- Validate Save To Photos, location auto-refresh and share sheet on a real device build (not testable in Expo Go web preview).
- Confirm new try-on share cards in iPhone/Android native share sheets and Photos, plus device-driven dark mode (web emulation was inconclusive).

## Bug fixes
### Camera upload connection loss — job-based fix (automated checks passed; device confirmation pending)
- User reports repeat failure in Expo Go on two devices in different countries. Screenshot shows native fetch network-lost error while analysing/removing background. Exact device-side transport cause cannot be proven without device logs, but long response wait is a confirmed architectural flaw; diagnostics also saw a tagging call exceed90s.
- New `backend/upload_jobs.py`: original photo validated/downscaled/stored privately, short raw-image POST `/api/items/upload-jobs/{id}` returns202 without waiting for AI; Mongo queue worker, progress GET, lease recovery, deterministic item id, deduplicated retries.
- Tagging and killable background-removal subprocess have25s limits; optional processing failures retain original photo/manual tags and show truthful warnings rather than blocking closet save.
- `src/item-upload.ts`: explicit expo/fetch raw File upload, response+body deadlines, automatic reconnection/status polling, stable retry IDs. Single/bulk UI has actual progress, keeps prepared photo, and supports pause/resume for single upload. Compression no longer silently uploads a full-resolution original on failure.
- Existing `/api/items/upload` retained for compatibility; new app uses the job route. No auth/model/provider/proxy changes.
- Verified: real image gallery→editor→Save; 6/6 public-API tests (acceptance~0.62s, total~5.1s), 8/8 fault tests for timeout/fallback/kill/requeue/leases, lost POST response after real acceptance recovers to exactly one item, bulk two-photo edit/save persists exactly two named items. A reported browser-picker automation block was resolved using the correctly timed listener; no picker changes were needed.
- Added 5s subprocess cleanup bound, graceful subprocess startup failure, stale-receipt retry state, concurrent conflicting-photo protection, and readable bulk errors. Background-removal/AI unavailability yields truthful manual-review warnings, not fake tags or a fabricated cutout.
- Current iOS bundle was fetched from its public manifest successfully (HTTP200,~19.45MB). This proves native bundling, not physical camera/network behavior. Real Expo Go capture on the user's two devices remains the final acceptance check.
- Reports: `test_reports/iteration_9.json`, `test_reports/iteration_9_followup.json`; tests `test_upload_jobs_iter9.py`, `test_upload_jobs_fault_injection_iter9.py`. No production integrations replaced by mocks; isolated failure adapters are tests only.

### Camera upload still failing on iPhone — forensic pass (fork, this session)
- Server logs proved that since the job rework **no upload request from the user's phone ever reached the backend**; the user's 17 earlier items were gallery uploads via the old endpoint. Failure is device-side before/at transport. User confirmed: iPhone only, camera only, sees "PREPARING PHOTO…"/"UPLOADING PHOTO…" stuck plus a red error. The red error text they pasted is `[runtime not ready]: Error: Cannot find native module 'ExpoAsset'` — the same error Metro received from an iOS client right after it loaded the preview bundle (plus `No native ExponentConstants module found`, `"main" has not been registered`). That error means the JS bundle ran in an iOS runtime lacking Expo's native modules — i.e. NOT Expo Go SDK 57 — likely the app installed from the Publish/App Store build, or a mismatched Expo Go. Package versions are all SDK 57 (`npx expo install --check` shows patch-level only). User also said "camera upload worked before the app was published".
- Changes made: (1) `POST /api/client-logs` (auth optional) + `src/client-log.ts` — phones report `photo_picked`, `prepare_failed`, `status_check_failed`, `send_failed`, `native_upload_fallback`, `upload_accepted`, `upload_failed`, `picker_failed` with platform/OS/runtime and the real underlying error, stored in `db.client_logs` and logged as `stylevault.client` WARNING. (2) `src/item-upload.ts` native POST now uses expo-file-system's native `File.upload` (BINARY_CONTENT, URLSession/OkHttp, 60s bound, pause-signal aware) with fallback to `file.bytes()` + expo/fetch. (3) Compression failure no longer blocks: `prepare()` in add-item falls back to the original photo (server downsizes anyway). Web upload flow re-verified end to end (photo → tags → save) after the change.
- Pending from user: which app/QR they open on iPhone (Expo Go from App Store vs installed build; preview QR vs deployment QR) and whether the ExpoAsset red screen appears at app start or after taking a photo.
- **Resolved (user-confirmed on iPhone, iOS 26.6.2, Expo Go SDK 57):** after the native-uploader change the camera photo (3024×4032, 3.2 MB → 289 KB) was accepted in 3.9 s and fully processed (cutout + tags) 4 s later; server `client_logs` show `photo_picked` → `upload_accepted` from the user's device. The ExpoAsset red screen appeared only after camera capture in the old JS-fetch path; not reproduced since.


### Upload speed pass (user: "slower than the initial version")
- Measured: cold rembg subprocess 1.9–2.8 s per photo, worker poll up to 1 s, client poll up to 1.5 s + extra "check" GET, Gemini tagging 2–4 s (dominant).
- Fixes: persistent warm cutout worker (`cutout_worker.py --serve`, length-prefixed protocol, killed/respawned on timeout; warm cutout ≈0.5 s, pre-warmed at startup); `accept()` wakes the worker instantly; up to 3 jobs processed concurrently; `GET /api/items/upload-jobs/{id}?wait=N` long-polls (≤25 s) so the client learns completion immediately; client skips the resume-check GET on a fresh upload and reuses picker width/height (no `Image.getSize`); tagging uses a 768 px copy (≈2 s vs ≈4 s). Server-side acceptance→ready now ≈2.5–4.7 s (3 concurrent photos in 4.75 s total); web flow pick→editor 4.1 s.
- Fault-injection tests updated for the warm worker/task-per-job loop: 8/8 pass.

### Published app stuck at "clearing background" (production resources)
- Deployment health check flags local rembg/ONNX inference as a BLOCKER for production container limits; published app (old snapshot) stalled at background removal while preview (8 GB / 4 CPU) was fine. User chose: **skip background removal in production, keep original photo, still auto-tag**.
- Implemented `cutout_enabled()` in `upload_jobs.py`: `CUTOUT_MODE=on|off|auto` (default auto → disabled when cgroup memory < 3 GB or CPU < 1.5 cores or < 2 cpus). When disabled: no model warm-up, no cutout, item keeps `-original.jpg`, `background_removed=false`, no warning text. Legacy `/api/items/upload` `remove_background` honours the same switch. Verified with CUTOUT_MODE=off: complete in 5.3 s, original kept, no warning. Preview stays cutout-enabled (log line "upload worker started cutout_enabled=…").
- User must Publish → Deploy again for the published app to pick up the new upload flow.

### Profile photo upload: "Cannot read property 'default' of undefined"
- Cause: `uploadProfilePhoto` used runtime `await import("react-native")` / `await import("expo-file-system")`; the async chunk resolution failed on device (published/exported bundles don't serve lazy chunks). Fixed by removing every dynamic `import()` from app code: static imports in `src/api.ts`, `src/item-upload.ts`; `uploadItemImage` moved into `item-upload.ts`. Native profile upload now uses expo-file-system `File.upload` (MULTIPART, field `file`); web uses FormData. Compression failure falls back to the original. Web verified: profile photo + add-item both work.

### Forgot password + default closet items removed
- `POST /api/auth/forgot-password` {email} → always generic 200; if the account has a password, emails a 6-digit code (bcrypt-hashed in `db.password_resets`, 15 min expiry, max 3 sends / 15 min, 5 attempts) via Emergent managed Resend (`backend/emailer.py`, `EMERGENT_EMAIL_KEY` + `EMAIL_FROM_NAME=StyleVault` in backend/.env, guardrail gate on every send). `POST /api/auth/reset-password` {email, code, new_password} → sets password, revokes all sessions, returns a fresh session (auto sign-in). UI: "FORGOT PASSWORD?" link on login → `src/components/forgot-password.tsx` (request → code + new password, resend, back). Verified: email accepted by proxy, wrong code rejected, known code resets + old password rejected.
- Default/mock closet items: seeding removed from register + Google sign-up; 325 existing `is_mock` items deleted from the DB. New accounts start with an empty closet.

### Brand: TheLookCraft icon, splash, wordmark
- Assets generated by `/tmp/make_brand.py` (Archivo Black + Inter, OFL) into `frontend/assets/images/`: `icon.png` (1024, black field, hairline frame, "LC" monogram + caption), `adaptive-icon.png` (transparent fg within safe zone, bg #000 in app.json), `splash-image.png` (1200 transparent, white mark; app.json imageWidth 260 on #000), `favicon.png`. Native icon/splash only appear in a real build (Expo Go shows its own icon).
- Wordmark centred and reduced: login 26 px / letterSpacing 4, index 20 px.

### Public website (backend-hosted) — thelookcraft.com forwards here
- Emergent has no custom domains for Expo deployments (support confirmed), so the site is served by FastAPI: `backend/website.py` (NOT `site.py` — that shadows the stdlib) mounted at `/api/site`: `/` landing (hero, 6 features, how-it-works, "Coming soon" App Store/Play badges), `/privacy`, `/terms`, `/support`, `/delete-account` (form → `/api/account/delete-request` → code page → `/api/account/delete-confirm`), `/icon.png` (from `backend/static/`), `/robots.txt`. Old `/api/account/privacy` and `/api/account/delete-request` GET 308-redirect to the site. HTML pages never return 5xx (edge proxy replaces 5xx with its own page); email 422 "undeliverable" → 400 with a friendly message. User action: at the registrar, forward thelookcraft.com → `https://<deployed-url>/api/site/`. Play Console URLs: `…/api/site/privacy`, `…/api/site/delete-account`.

### Account deletion / disable + privacy policy (Play Store data-safety requirements)
- `backend/account.py` (router mounted at `/api/account`): `POST /close` {mode: disable|delete} (auth) used in-app; public login-free HTML flow `GET/POST /delete-request` (email → 6-digit code via managed email, 3 sends/15 min) → `POST /delete-confirm` (code + radio disable/delete); `GET /privacy` hosts the Privacy Policy (contact support@thelookcraft.com — placeholder until the user confirms). Delete = overwrite every stored photo with an empty object (storage has no delete API), then delete items/outfits/feedback/wear_log/visualizations/upload_jobs/profiles/sessions/client_logs/codes/user. Disable = `users.disabled_at` + sessions revoked; sessions of disabled users are 401; signing in (password, Google or password-reset) reactivates and returns `reactivated: true` → login toast.
- Frontend: Profile → "PRIVACY & DATA" (`src/components/privacy-data.tsx`): Privacy Policy (in-app browser), Disable account, Delete account & data (bottom-sheet confirm) → signs out; `useAuth().closeAccount`. Play Console URLs: privacy `…/api/account/privacy`, deletion `…/api/account/delete-request` (use the DEPLOYED backend domain).
- Verified via curl + web: disable → login reactivates → in-app delete wipes 2 photos + all records → token 401, login 401.

### Store identifiers
- Android `package` and iOS `bundleIdentifier` set to `com.thelookcraft.app` (reverse of thelookcraft.com) for Play Console / App Store Connect. Scheme and storage prefixes unchanged.

### Empty Closet Welcome (first-run)
- `src/components/closet-welcome.tsx`: `ClosetWelcome` full card for an empty closet (All filter) — why 5 pieces, numbered starter list (Top, Bottoms, Shoes, Layer, Accessory), "Snap With Camera" / "Pick From Gallery" buttons that deep-link to `/add-item?source=camera|library` (add-item auto-opens the picker once). `StarterProgress` strip above the grid while < 5 items: "N OF 5 STARTER PIECES", one square per category (filled when covered), "NEXT: ADD …" hint, tap → add-item. `Button` gained an optional `icon` prop. Verified on web with the empty QA account (0 items → card; 1 item → strip with Tops done, next Bottoms).

### Readiness health-check investigation
- User asked to run health check, then fix its reported blocker. Two checks returned FAIL solely for missing `--tunnel`; all other reported configuration/compilation checks passed. First run also warned about local rembg resource usage (unchanged).
- Independently verified public preview HTTP 200, `/api/` HTTP 200 with StyleVault response, Expo/backend RUNNING, public iOS Expo manifest runtime `exposdk:57.0.0`, and launch bundle URL using the configured public proxy hostname.
- `EXPO_PACKAGER_PROXY_URL` is configured in both frontend environment and Supervisor. `/etc/supervisor/conf.d/supervisord.conf` is explicitly readonly/platform-managed. No code/configuration changes made; adding a second ngrok tunnel is not the appropriate correction.
- Platform support advises a health-check logic update. User may contact support@emergent.sh with Job ID, screenshot, and reference “Expo managed proxy false positive blocker.” Automated readiness remains FAIL until platform tooling is corrected; do not claim a passing check.

- **Stylist tab fixes:** (a) iOS 26 NativeTabs hid the composer/FAB behind the tab bar → native tabs disabled (`usesNativeTabs=false`), JS Tabs everywhere; (b) "Try Another" re-sends the same prompt with `avoid_item_ids` so Gemini proposes a different look; (c) result cards are editable: dismiss (X), tap piece → swap, remove badge, ADD PIECE tile, CLEAR CONVERSATION; edited looks reset Saved. (d) "Style around this" from item detail now hands off via `src/stylist-focus.ts` store + `router.dismissTo` (route params raced the modal dismiss on iOS).
- **"Unsupported FormDataPart implementation" on Expo Go:** Expo SDK 57's global fetch rejects RN's legacy `{uri,name,type}` FormData part. `uploadItemImage` now appends `new File(uri)` from `expo-file-system` on native (Blob-compatible, filename+mime from URI). Verified via Node port of expo's `convertFormDataAsync` + web regression.
- **Camera add-item silent failure (iOS Expo Go):** add-item is a native modal so root toasts rendered beneath it; large camera photos (~10 MB) took ~50 s and timed out. Fixed: on-device compression (`src/compress-image.ts`, expo-image-manipulator, 1280px JPEG), inline error + Try Again / Choose Another inside the modal, backend downscale before Gemini + concurrent tagging/rembg (~6-10 s).
