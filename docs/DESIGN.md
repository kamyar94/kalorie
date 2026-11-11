# Kal: photo-first food log (design, draft 1)

Kal is a self-hosted web app, installable on phones, tablets and desktops, that records what a
person eats from one to three photos. The server works out the foods, amounts, calories and
nutrients, files the meal by time, and lets the person review and correct every detail.
Accounts are invite-only. Kal connects to a Mealie server (recipes and meal plans) and an
openGym server (body weight and workouts).

This file is the build reference. It is written to be safe in a public repository: no host
names, no server paths, no personal data. Deployment values live in the server stack's own
files.

## 1. Principles

1. **Capture is one tap.** Open the app, press the shutter, take one to three photos, press
   Send. Nothing else is required. Everything optional (a note, a time change) can wait.
2. **The AI recognises, the database counts.** The vision model names the foods and estimates
   amounts. Nutrients come from a food composition database for each matched item, so numbers
   are traceable and consistent. The model's own nutrient guess is used only when nothing
   matches, and is labelled as such.
3. **Amounts are the weak spot, so correcting them must be instant.** Published tests put
   photo-only calorie error for current general models at about 30 percent, mostly from
   portion size (eatwell evaluation on 62 weighed Nutrition5k plates; GPT-5 drops from 30.5 to
   13.9 percent error when ingredients are described). Every item has a grams control and
   portion buttons that rescale all nutrients immediately, and a short note at capture is
   offered because it helps the most.
4. **Kal learns from corrections.** A dish the person has corrected is recognised and reused
   the next time, which matters for home cooking that no database covers.
5. **Private by default.** Each person sees only their own data. Photos stay on the server
   except for the analysis call to the AI provider the person chose with their own key.
6. **Quality bar.** As polished as the best commercial food apps: large readable numbers,
   one-handed use, light and dark themes, smooth transitions, no dead ends, accessible.

## 2. Users and access

- Invite-only. An admin creates single-use invite codes (expiry 7 days) from the admin page or
  the server tool; the invite page lets the new person choose a username, display name and
  password. No public sign-up, no email needed.
- Roles: `admin` and `member`. Admins manage invites, users (disable, reset), and see usage
  totals, never other people's meals or photos.
- Sign-in: username + password (scrypt), session cookie stored hashed, 5 wrong passwords lock
  the account for 15 minutes, per-IP limiter, password reset codes made by an admin. Reuse the
  proven implementation from the Lingo project (`lib/auth.ts` and its scripts).
- Every query is scoped by user id; tests prove one user cannot read another user's meals,
  photos, foods, keys or integrations.

## 3. Capture (client)

**Shutter.** The Today screen has one large round shutter button within thumb reach. It opens
an in-app full-screen camera (`getUserMedia`, rear camera, highest still resolution the device
offers). Each tap adds a photo to a strip of up to three thumbnails (tap a thumbnail to delete
it). Buttons on that screen: shutter, gallery (pick existing photos), hold-to-talk note, Send,
close. If the camera API is refused or missing, fall back to
`<input type="file" accept="image/*" capture="environment">`.

**Note.** Optional. Hold the microphone button to dictate (browser speech recognition where
available, including iOS Safari), or tap to type. Examples: "ate half", "fried in olive oil",
"two skewers". Shown under the thumbnails.

**Time.** The meal time is the moment of the first photo, in the device's time zone (IANA name
sent with it). Gallery photos use the EXIF capture time when present (read on the device before
re-encoding). The meal slot (breakfast, lunch, dinner, snack) is set from the local time using
the person's meal windows (defaults 04:00-10:30, 11:00-15:00, 17:00-21:30, other times snack;
editable).

**Upload.** Photos are resized on the device (long edge 2048 px, JPEG quality 0.85) through a
canvas, which also turns iPhone HEIC into JPEG and drops all metadata (no GPS leaves the
device). The meal is saved to an IndexedDB queue first, then uploaded. If the device is
offline, the Today screen shows "waiting to upload" and the queue is sent when the app is next
open and online (iOS has no Background Sync for web apps; use it on browsers that have it).
After Send the camera closes at once and the new meal card appears with an "analysing" state.

## 4. Analysis (server worker)

A separate worker process (same image, different command) takes jobs from a Postgres queue
(`FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY` to wake). Steps for a meal:

1. **Photo intake.** Decode with `sharp` (pixel limit against decompression bombs), re-encode,
   strip metadata, store the 2048 px original, a 1280 px analysis copy and a 400 px thumbnail.
2. **Vision call** with the person's provider and model for the task `analysis`, through the
   shared AI layer (`lib/ai`, reused from Lingo: OpenAI, Anthropic and Google adapters, images,
   JSON-schema output, encrypted per-user keys, rate limits, usage records). Input: the photos,
   the note, local time and slot, the person's usual meals (top 30 corrected dishes with typical
   portions), today's planned Mealie recipes when connected, preferred cuisines (profile
   setting, for example Persian home cooking), and units. Output (JSON schema):
   - `is_food`, `title`, `cuisine`, `overall_confidence`, `questions` (at most two short
     clarifying questions, each with two to four suggested answers);
   - `items[]`: `name`, `local_name` (for example the Persian name), `kind` (dish, ingredient,
     drink, packaged), `preparation` (raw, boiled, fried, grilled...), `grams` (or `ml` for
     drinks), `grams_low`, `grams_high`, `portion_text` ("1 cup", "2 skewers"), `confidence`,
     `photo_indexes`, `search_terms[]`, `matches_usual` (id of a usual meal, if any),
     `matches_planned` (Mealie recipe id, if any), `components[]` for mixed dishes (name,
     grams), `label` (nutrition facts or barcode digits read from a visible package), and an
     `estimate` of kcal, protein, carbs, fat, fiber, sugar and sodium as the last-resort
     fallback.
   A photo that is not food ends the job with a friendly message and no AI retry.
3. **Matching.** For each item, search the local food tables (section 5) with its search terms,
   boosted by the person's own memory of past corrections. Send all items and their top eight
   candidates in one text-only call (task `matching`, a cheaper model by default) that picks a
   candidate id or `none` per item. Deterministic fallback when AI is unavailable: the best
   trigram score above a threshold.
4. **Nutrients.** Item nutrients = matched food per 100 g x grams / 100 (density for ml).
   Mixed dish without a match: sum of its matched components. No match at all: the model's
   estimate, labelled "AI estimate". Planned Mealie recipe: the recipe's nutrition per serving
   (section 8). Usual meal: the person's corrected values, scaled.
5. **Result.** The meal becomes `ready` (or `needs_input` when questions are open) and a push
   notification is sent if the person turned them on. Answering a question, or typing a
   correction ("it was chicken, not beef"), re-runs steps 2 to 4 with that text added; the
   person's manual edits to grams and matches are kept unless they ask to replace them.
6. **Failures.** Retries with backoff for provider errors; missing or invalid key, quota and
   refusals give a clear message on the meal card with a link to the AI settings. A meal can
   always be completed by hand.

Model defaults are editable per person and task. Suggested default: Google Gemini Flash at low
reasoning effort for `analysis` (most accurate and cheapest of nine current models on weighed
plates in the eatwell evaluation), a small model for `matching`. Model IDs must be checked
against each provider's model documentation at build time.

## 5. Food data

- **USDA FoodData Central** (public domain), imported into Postgres: Foundation Foods, SR
  Legacy and FNDDS (survey foods, which carry household portion weights). Pinned release files
  with recorded SHA-256; importer `scripts/fdc-import.mjs` run by the server tool. Branded
  Foods are not imported (size); packaged products come from Open Food Facts instead.
- **Open Food Facts** (ODbL): barcode lookup by API with a proper User-Agent, cached locally;
  products saved as foods with per-100 g values and attribution.
- **Dishes:** composite foods made of components (food id + grams per serving), computed from
  their components. Seed a set of common Persian dishes (for example ghormeh sabzi, gheymeh,
  fesenjan, kabab koobideh, joojeh kabab, chelow, tahdig, zereshk polo, sabzi polo, adas polo,
  ash reshteh, kashk bademjan, mirza ghasemi, kuku sabzi, kotlet, olivieh, shirazi salad,
  sholeh zard, doogh) from typical recipes, each marked "recipe estimate" with its source
  noted; names in English and Persian.
- **Personal foods:** foods and dishes a person creates or corrects are theirs (owner id) and
  rank first in their searches.
- **Search:** `pg_trgm` + full text over English and Persian names and synonyms, typo
  tolerant, with the person's recent and frequent foods first.
- **Nutrient catalogue:** one table of nutrients (code, name, unit, group, display order)
  mapped from FDC nutrient ids. Shown: energy, protein, fat (saturated, mono, poly, trans),
  cholesterol, carbohydrate, fiber, total and added sugars, sodium, potassium, calcium, iron,
  magnesium, phosphorus, zinc, copper, selenium, vitamins A (RAE), C, D, E, K, B1, B2, B3, B6,
  B12, folate (DFE), choline, caffeine, alcohol, water. All FDC values are stored.

## 6. Targets

From the profile (sex, birth year, height, weight, activity level, goal): Mifflin-St Jeor
resting energy times an activity factor, adjusted by the goal (lose, keep, gain, rate per
week). Macro defaults: protein 1.6 g per kg, fat 30 percent of energy, carbohydrate the rest.
Vitamins and minerals from the US Dietary Reference Intakes (RDA or AI, and upper limits) by
sex and age band, stored as a static table with its source. Every target is editable; edited
targets stay fixed until reset. Weight comes from the profile or from openGym when connected.

## 7. Screens

- **Today:** the date with swipe to the previous and next day; a summary (calories eaten of
  target as a ring, protein, carbs, fat bars); the day's meals as a timeline of cards (photo,
  time, title, kcal, state: uploading, analysing, needs answer, ready); planned Mealie meals
  as tap-to-log chips; workouts from openGym with an energy estimate; the shutter.
- **Meal:** photos (swipe, pinch to zoom); time and slot (editable); items list (name, amount,
  kcal); open questions as answer chips; "fix with a sentence" field; totals with a full
  nutrient table; delete meal; duplicate to another day ("I ate this again").
- **Item sheet:** grams slider over the model's low to high range plus free entry, portion
  buttons from the food's portions, count stepper, the matched food with "change" (search),
  the item's nutrients, delete. Changes save themselves.
- **Add without a photo:** search, barcode scan (`BarcodeDetector` where available, a WASM
  ZXing build otherwise), label photo, recent and frequent foods, Mealie recipes.
- **Trends:** day, week and month views: energy and macros per day against targets, average by
  meal slot, time-of-day pattern, nutrients consistently below or above target, top foods,
  weight from openGym overlaid.
- **Settings:** profile and targets, AI (keys per provider, provider and model per task, test
  button, usage), meal windows, units (metric default, imperial), cuisines, notifications,
  integrations (Mealie, openGym), export (CSV and JSON), delete my data.
- **Admin:** invites, users, usage totals.
- Layout: phone first (360 to 430 px), two columns on tablet and desktop. Touch targets at
  least 44 px, WCAG AA contrast, `dir="auto"` on food names so Persian text renders right.

## 8. Integrations

Both integrations use base URLs set on the server only (never typed by users, so no
server-side request forgery) and per-user credentials stored encrypted like AI keys.

**Mealie.** The person pastes a Mealie API token (Mealie profile, API tokens).
- Today shows the household's planned recipes for the day (`GET /api/households/mealplans/today`);
  one tap logs a recipe with a servings stepper.
- Recipe nutrition per serving comes from Mealie's recipe nutrition fields; when they are
  empty, Kal computes it from the recipe's ingredients through matching and keeps it as a
  dish marked "computed".
- Mealie recipes appear in search, and planned recipe names go into the photo analysis context
  so a photo of tonight's planned dinner is linked to its recipe.
- Meal plan suggestions: the person picks days and slots; Kal proposes recipes from Mealie that
  keep each day within the energy target and above the protein target (deterministic search
  over recipes with nutrition), shows the plan, and writes it to Mealie
  (`POST /api/households/mealplans`) only after the person confirms. Plans in Mealie are shared
  by the household, which the confirm screen says.
- "Save nutrition to Mealie" on a recipe whose nutrition is empty writes Kal's computed values,
  only on that button.

**openGym.** openGym signs in with passkeys and pairs other apps with a code.
- The person creates a pairing code in openGym (Settings, pair the mobile app; 8 characters,
  valid 5 minutes) and pastes it into Kal. Kal redeems it (`POST /api/pair/redeem`) for a
  bearer token, keeps it encrypted, and renews it as `/api/me` returns fresh tokens.
- Kal reads the account state (`GET /api/data`): weigh-ins (latest weight for targets, chart
  overlay) and workouts (date, duration, exercises) for an energy-burned estimate from MET
  values x body weight x duration, labelled as an estimate. Kal never writes to openGym.

## 9. Notifications

Web Push with VAPID keys made on the server. Optional, off until the person turns it on:
"analysis ready" and "a question about your meal". Works in installed web apps on iOS 16.4
and later, Android and desktop browsers.

## 10. Data model (Postgres, Drizzle migrations)

users, sessions, invites, reset_codes, rate_limits (from Lingo); ai_keys, ai_settings,
ai_usage (from Lingo, tasks `analysis` and `matching`); meals (user, eaten_at, tz, slot, title,
note, status, source, analysis JSON, questions, error, timestamps, soft delete); meal_photos
(meal, paths, size, sha256, order); meal_items (meal, position, names, food reference, grams,
ml, portion, count, model estimate and range, confidence, edited flag, nutrients JSON,
nutrient source, components); foods (source, source id, owner, names in English and Persian,
synonyms, category, brand, barcode, per-100 g nutrients JSON, density, search columns);
food_portions; dish_components; nutrients; dri_targets; user_targets; food_memory (user,
normalised name, food, typical grams, count, last used); integrations (user, kind, encrypted
credential, settings, last sync, status); push_subscriptions; jobs; audit_log.

## 11. Stack

Next.js (App Router), React, TypeScript, Tailwind with a small component set (Radix
primitives), Drizzle with node-postgres, Postgres, `sharp`, Vitest, Playwright. Node on
Alpine. Reuse from the Lingo project, adapted rather than imported: auth, invite and reset
tooling, the AI layer and its mock server for tests, the start script that applies migrations,
the egress proxy configuration, and the hardened deployment layout.

## 12. Hosting and security

- Services: `app` (web), `worker` (analysis jobs), `db` (Postgres, named volume), `egress`
  (Squid allowlist proxy), `tunnel` (Cloudflare connector). No published ports.
- Networks: tunnel net (tunnel and app, internal), backend net (app, worker, db, egress,
  internal), outbound nets only for egress and tunnel. App and worker reach the internet only
  through the proxy, which allows the three AI APIs, Open Food Facts, the FDC download host,
  the Mealie and openGym hosts, and the Web Push services.
- Every container: `cap_drop: ALL`, `no-new-privileges`, non-root, read-only root filesystem
  with small tmpfs, memory, CPU and PID limits, log rotation, pinned image versions.
- Photos on a bind-mounted folder; served only through an authenticated route that checks the
  owner. Upload limits (3 photos, 8 MB each after resizing, 25 MB per request), image type
  checked from content.
- Secrets: database password, the app secret that encrypts keys and tokens, VAPID keys and
  the tunnel token each in their own env file, generated on the server, locked by the start
  script, never printed.
- Server tool (`scripts/cal.mjs` in the container, wrapped by a PowerShell script): invite,
  reset, list users, import food data.
- Strict CSP, security headers, CSRF protection on mutations, rate limits on sign-in, upload
  and AI calls.

## 13. Testing

- Unit: nutrient math, portion scaling, density, target formulas, matching ranks, slot rules.
- Integration with Postgres: job queue (concurrency, retries), per-user isolation for every
  route, invite and lockout flows, importers on small fixture files.
- AI: the mock provider server replays recorded replies for all three providers, including
  errors, refusals, malformed JSON and timeouts.
- End to end (Playwright, phone and desktop sizes, Chromium fake camera and file upload):
  invite, sign-in, capture three photos, offline queue, analysis, edit an item, answer a
  question, barcode add, Mealie log and plan (mock Mealie), openGym pairing (mock openGym),
  export.
- An accuracy script (`scripts/eval.mjs`) the owner can run with their own key on their own
  weighed meals, reporting calorie and macro error per provider and model.
- Deployment checks: no published ports, non-root, read-only, egress only through the
  allowlist, secrets absent from images and logs.

## 14. Build phases

1. Foundations: repository, Lingo modules adapted, schema and migrations, job queue and
   worker, photo upload and storage, PWA shell (manifest, service worker, icons), design
   tokens and base components, the contracts the later phases share (food search, nutrient
   types, job payloads).
2. Food data: FDC import, nutrient catalogue, portions, search, Open Food Facts, dishes and the
   Persian dish seed, DRI table.
3. Analysis: prompts and schemas, provider calls, matching, nutrient computation, questions,
   re-analysis, memory, failure handling.
4. App screens: camera and offline queue, Today, Meal, item sheet, add and barcode, trends,
   settings, admin.
5. Integrations and push: Mealie, openGym, Web Push.
6. Deployment: compose stack, proxy allowlist, scripts, server README, full local stack test.
7. Verification.

## 15. Not in this version

Native apps; Apple Health and Health Connect sync (not reachable from a web app); image
embeddings for photo similarity; a local vision model; server-side speech-to-text.
