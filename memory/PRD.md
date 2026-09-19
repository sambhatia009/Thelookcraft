# StyleVault — Product Requirements Document

## Original Problem Statement
Build "StyleVault", a mobile-first AI Personal Stylist & Virtual Wardrobe app. Users upload photos of clothes/shoes/accessories; the app auto-categorizes and tags them into a digital closet. Users ask an AI stylist to build outfits for occasions or to match a specific piece. Clean, high-end editorial aesthetic (SSENSE/Farfetch), light & dark mode, 4-tab bottom nav (Closet, Stylist, Lookbook, Profile), FAB upload with background-removal styling and auto-tags, AI chat with quick prompts + item attachment, outfit composite cards with a Stylist Note, save/try-another actions, and profile personalization.

## Architecture
- **Frontend:** Expo React Native (expo-router file routing), react-query, react-native-reanimated, expo-image, phosphor icons. Monochrome brutalist theme (light+dark) in `src/theme.ts`.
- **Backend:** FastAPI + MongoDB (motor). Bearer session tokens (7-day) in `user_sessions`.
- **AI:** Gemini 3 Flash via emergentintegrations (`EMERGENT_LLM_KEY`) for vision auto-tagging + stylist outfit generation (structured JSON).
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

## Backlog (prioritized)
- **P1:** Outfit "shop the missing item" links; weather auto-detect via location; multi-select bulk upload.
- **P2:** Wardrobe analytics (most-worn, color distribution); share outfit as an editorial image card; calendar/outfit planner.

## Next Tasks
- Location-based weather context for smarter seasonal suggestions.
- Shareable outfit export.
