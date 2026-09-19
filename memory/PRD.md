# StyleVault — Product Requirements Document

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
- **P1:** calendar/outfit planner; wear history timeline.
- **P2:** cost-per-wear; optional render-only share card layout.

## Next Tasks
- Validate Save To Photos, location auto-refresh and share sheet on a real device build (not testable in Expo Go web preview).
- Confirm new try-on share cards in iPhone/Android native share sheets and Photos, plus device-driven dark mode (web emulation was inconclusive).

## Bug fixes
- **Stylist tab fixes:** (a) iOS 26 NativeTabs hid the composer/FAB behind the tab bar → native tabs disabled (`usesNativeTabs=false`), JS Tabs everywhere; (b) "Try Another" re-sends the same prompt with `avoid_item_ids` so Gemini proposes a different look; (c) result cards are editable: dismiss (X), tap piece → swap, remove badge, ADD PIECE tile, CLEAR CONVERSATION; edited looks reset Saved. (d) "Style around this" from item detail now hands off via `src/stylist-focus.ts` store + `router.dismissTo` (route params raced the modal dismiss on iOS).
- **"Unsupported FormDataPart implementation" on Expo Go:** Expo SDK 57's global fetch rejects RN's legacy `{uri,name,type}` FormData part. `uploadItemImage` now appends `new File(uri)` from `expo-file-system` on native (Blob-compatible, filename+mime from URI). Verified via Node port of expo's `convertFormDataAsync` + web regression.
- **Camera add-item silent failure (iOS Expo Go):** add-item is a native modal so root toasts rendered beneath it; large camera photos (~10 MB) took ~50 s and timed out. Fixed: on-device compression (`src/compress-image.ts`, expo-image-manipulator, 1280px JPEG), inline error + Try Again / Choose Another inside the modal, backend downscale before Gemini + concurrent tagging/rembg (~6-10 s).
