# Kal: photo-first food log (design)

Kal is a self-hosted web app, installable on phones, tablets and desktops, that records what a
person eats from one to three photos or a sentence. The server works out the foods, amounts,
calories and nutrients, files the meal by time, and lets the person review and correct every
detail. Around the meals it keeps water from drinks, medicines, activities (Move) and body
measurements (Body). Accounts are invite-only. Kal connects to a Mealie server (recipes and meal
plans) and an openGym server (body weight and workouts), and an optional Android app sends
records from Health Connect (section 14).

This file is the design reference of the code as it is. It is written to be safe in a public
repository: no host names, no server paths, no personal data. Deployment values live in the
server stack's own files.

## 1. Principles

1. **Capture is one tap.** Open the app, press the shutter, take one to three photos (or type a
   sentence), press Send. Nothing else is required. Everything optional (a note, a time change)
   can wait.
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
5. **Private by default.** Each person sees only their own data. Meal and label photos stay on
   the server except for the analysis call to the AI provider the person chose with their own
   key. Body photos never leave the server, and the health profile goes with a meal analysis
   only when the person turns that on.
6. **Quality bar.** As polished as the best commercial food apps: large readable numbers,
   one-handed use, light and dark themes, smooth transitions, no dead ends, accessible.

## 2. Users and access

- Invite-only. An admin creates single-use invite codes (expiry 7 days) from the admin page or
  the server tool; the invite page lets the new person choose a username, display name and
  password. No public sign-up, no email needed.
- Roles: `admin` and `member`. Admins manage invites, users (disable, reset), and see usage
  totals, never other people's meals, photos or health data.
- Sign-in: username + password (scrypt), session cookie stored hashed (30 days by default), 5
  wrong passwords lock the account for 15 minutes, per-IP limiter, password reset codes made by
  an admin (`lib/auth`).
- Every query is scoped by user id; tests prove one user cannot read another user's meals,
  photos, foods, keys or integrations.

## 3. Capture (client)

**Camera.** The round camera button in the middle of the navigation opens an in-app full-screen
camera (`getUserMedia`, rear camera). Tabs at the bottom choose the mode: Meal, Medicine or
Body. If the camera API is refused or missing, or no picture arrives within a few seconds, the
screen offers the phone's own camera (`<input type="file" accept="image/*"
capture="environment">`) and the gallery instead.

**Meal.** Each tap adds a photo to a strip of up to three thumbnails (tap a thumbnail to delete
it). Buttons on that screen: shutter, gallery (pick existing photos), hold-to-talk note, the
When chip, Type, Send, close.

**Type.** Switches to a meal in words: the camera stops and a large text box ("What did you
eat?") takes its place, with dictation where the browser has speech recognition. The meal is
sent without photos (source `text`) and the analysis reads the words.

**Note.** Optional. Hold the microphone button to dictate (browser speech recognition where
available, including iOS Safari), or tap to type. Examples: "ate half", "fried in olive oil",
"two skewers". Shown under the thumbnails.

**Time.** The meal time is the moment of the first photo, in the device's time zone (IANA name
sent with it). Gallery photos use the EXIF capture time when present (read on the device before
re-encoding). The When chip at the top sets another time: Now, 30 min ago, 1 hour ago, 2 hours
ago, This morning, Yesterday, or any date and time within the last year (`lib/ui/when.ts`).
The meal page's Time button changes it later.

**Meal names (slots).** Breakfast, brunch, lunch, dinner, supper, snack, drink or dessert
(`lib/meals/classify.ts`). A meal of drinks only is a drink; words that say brunch make a
brunch; otherwise the analysis model's meal type counts. The day's first main meal without a
breakfast before it, eaten from 30 minutes before the breakfast window ends to 90 minutes after
the lunch window starts (10:00-12:30 by default), is a brunch. Meals without a model type
follow the person's meal windows (defaults 04:00-10:30, 11:00-15:00, 17:00-21:30; editable):
under 250 kcal in the lunch and dinner windows is a snack, and 250 kcal or more after the dinner
window and before 04:00 is supper. The day is named again after every change; a name the person
picks by hand (`meals.slot_locked`) never changes.

**Medicine.** One photo of a box or blister. The job `read-medicine-label` (section 4) reads it
and a sheet opens to check the name, strength, form, amount and time before the dose is logged.
"Type" opens the same sheet empty.

**Body.** Guided front, left, back and right photos with a pose outline and a self-timer. The
original is kept at full size without metadata, only its owner can open it, and it is never
sent to an AI.

**Upload.** Meal photos are resized on the device (long edge 2048 px, JPEG quality 0.85) through
a canvas, which also turns iPhone HEIC into JPEG and drops all metadata (no GPS leaves the
device). The meal is saved to an IndexedDB queue first, then uploaded. If the device is offline,
the Today screen shows "waiting to upload" and the queue is sent when the app is next open and
online (iOS has no Background Sync for web apps; it is used on browsers that have it). After
Send the camera closes at once and the new meal card appears with an "analysing" state.

## 4. Analysis (server worker)

A separate worker process (same image, different command) takes jobs from a Postgres queue
(`FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY` to wake): `analyze-meal`, `read-medicine-label` and
`send-push`. Steps for a meal (photos, words, or both):

1. **Photo intake.** Decode with `sharp` (pixel limit against decompression bombs), re-encode,
   strip metadata, store the 2048 px original, a 1280 px analysis copy and a 400 px thumbnail.
2. **Vision call** with the person's provider and model for the task `analysis`, through the
   shared AI layer (`lib/ai`: OpenAI, Anthropic and Google adapters, images, JSON-schema output,
   encrypted per-user keys, rate limits, usage records). Input: the photos (none for a meal in
   words), the note or the words, local time and slot, the meals logged earlier that day, the
   person's usual meals (top 30 corrected dishes with typical portions), today's planned Mealie
   recipes when connected, preferred cuisines (profile setting, for example Persian home
   cooking), units, and the allergies and conditions of the health profile only when "Use in
   meal analysis" is on. Output (JSON schema, `lib/analysis/schema.ts`):
   - `is_food`, `not_food_kind` (none, medicine, supplement, other), `title`, `cuisine`,
     `meal_type` (one of the eight slots), `overall_confidence`, `questions` (at most two short
     clarifying questions, each with two to four suggested answers);
   - `items[]`: `name`, `local_name` (for example the Persian name), `kind` (dish, ingredient,
     drink, packaged), `emoji` (one emoji for the food), `preparation` (raw, boiled, fried,
     grilled...), `grams` (and `ml` for drinks), `grams_low`, `grams_high`, `portion_text`
     ("1 cup", "2 skewers"), `confidence`, `photo_indexes`, `search_terms[]`, `matches_usual`
     (id of a usual meal, if any), `matches_planned` (Mealie recipe id, if any), `same_as_item`
     (on a re-analysis, the current item it is), `components[]` for mixed dishes (name, grams),
     `label` (barcode, serving size and nutrition facts read from a visible package), and an
     `estimate` of kcal, protein, carbs, fat, fiber, sugar and sodium as the last-resort
     fallback.
   A photo that is not food ends the job with a friendly message and no AI retry. When it shows
   a medicine or a supplement, the meal offers "Log as a medicine": the label is read from the
   meal's photo, and the meal is removed once the dose is logged.
3. **Matching.** For each item, search the local food tables (section 5) with its search terms,
   boosted by the person's own memory of past corrections. Send all items and their top eight
   candidates in one text-only call (task `matching`, a cheaper model by default) that picks a
   candidate id or `none` per item. Deterministic fallback when AI is unavailable: the best
   trigram score above a threshold.
4. **Nutrients.** Item nutrients = matched food per 100 g x grams / 100 (density for ml).
   Mixed dish without a match: sum of its matched components. No match at all: the model's
   estimate, labelled "AI estimate". Planned Mealie recipe: the recipe's nutrition per serving
   (section 8). Usual meal: the person's corrected values, scaled. The emoji is the model's, or
   one picked from the food's name (`lib/food/emoji.ts`).
5. **Result.** The meal becomes `ready` (or `needs_input` when questions are open), its day is
   named again (section 3), and a push notification is sent if the person turned them on.
   Answering a question, or typing a correction ("it was chicken, not beef"), re-runs steps 2
   to 4 with that text added; the person's manual edits to grams and matches are kept unless
   they ask to replace them. Adding or removing photos re-runs the analysis only when "Update
   items from the photos" is on.
6. **Failures.** Retries with backoff for provider errors; missing or invalid key, quota and
   refusals give a clear message on the meal card with a link to the AI settings and Try again.
   Saving a key queues again the person's photo and text meals of the last 7 days (at most 10)
   that stopped for a key problem. A meal can always be completed by hand.

**Medicine labels.** The job `read-medicine-label` sends the label photo to the person's
provider with a strict schema (name, strength, form, active ingredients). The model only
transcribes the label; Kal gives no advice on doses or interactions. A label photo that never
became part of a log is removed after a day.

Model defaults are editable per person and task. Suggested default: Google Gemini Flash at low
reasoning effort for `analysis` (most accurate and cheapest of nine current models on weighed
plates in the eatwell evaluation), a small model for `matching`. Model IDs must be checked
against each provider's model documentation whenever they are changed.

## 5. Food data

- **USDA FoodData Central** (public domain), imported into Postgres: Foundation Foods, SR
  Legacy and FNDDS (survey foods, which carry household portion weights). Pinned release files
  with recorded SHA-256; importer `scripts/fdc-import.mjs` run by the server tool. Branded
  Foods are not imported (size); packaged products come from Open Food Facts instead.
- **Open Food Facts** (ODbL): barcode lookup by API with a proper User-Agent, cached locally;
  products saved as foods with per-100 g values and attribution.
- **Dishes:** composite foods made of components (food id + grams per serving), computed from
  their components. A set of common Persian dishes is seeded (for example ghormeh sabzi,
  gheymeh, fesenjan, kabab koobideh, joojeh kabab, chelow, tahdig, zereshk polo, sabzi polo,
  adas polo, ash reshteh, kashk bademjan, mirza ghasemi, kuku sabzi, kotlet, olivieh, shirazi
  salad, sholeh zard, doogh) from typical recipes, each marked "recipe estimate" with its source
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
sex and age band, stored as a static table with its source. Without a complete profile the
defaults are 2,000 kcal and the US Daily Values. Every target is editable; edited targets stay
fixed until reset. Weight comes from the profile, or from openGym's latest weigh-in while
openGym is paired.

Water from drinks has its own goal: 1.6 L for women, 2.0 L for men and 1.8 L without a sex in
the profile (EFSA's adequate intake, about 80 percent of it from drinks), or the person's own.
On each day it grows by about 0.5 L per hour of moderate or harder activity, rounded to 0.1 L
and at most 1.5 L more (`lib/move/water.ts`). Today's "kcal left" adds the energy estimate of
the day's openGym workouts.

## 7. Screens

- **Navigation:** phones have a bottom bar (Today, Move, the camera, Body, More); wide screens
  a rail with the same items. More lists Trends, Add food, Favorites, Medicines, Plan meals
  (when Mealie is connected), Kal for Android, Settings and, for admins, Admin.
- **Today:** the date with swipe to the previous and next day; a summary (calories eaten of
  target as a ring, kcal left, protein, carbs, fat bars); the Water card (the day's water from
  drinks against its goal, the latest entries with Show all, + Glass, + Bottle and + Other
  amount, and a sheet that changes an entry's amount and time or removes it); the Move card
  (steps with where they came from, "Steps · Phone, updated 23:04", active time and activity
  calories, the phone's when Kal for Android 1.2 sent them, else Kal's active minutes and the
  energy of its activities, and the day's points; the steps and Details open Move for the same
  day); the Medicines card (each medicine with Log now, or
  the time it was taken, which opens a sheet to change the time and amount); "Log a favorite
  again" chips; planned Mealie meals as tap-to-log chips; workouts from openGym with an energy
  estimate; the day's meals as a timeline of cards (the cover photo, or for a meal without a
  photo a plate drawn from its food emoji; time and meal name; title; the foods with their
  emoji; kcal; state: uploading, analysing, needs answer, ready, or failed with Try again and,
  for a medicine, Log as a medicine).
- **Meal:** photos (swipe, pinch to zoom, full screen); Photos to add up to three, remove one
  or choose the cover, with "Update items from the photos" (off by default); time and meal name
  (Time, and Edit for the title, time and meal name); "What you wrote" for a meal in words;
  open questions as answer chips or the person's own words; "Fix with a sentence" (with "Also
  replace the changes I made by hand"); items list (emoji, name, amount, kcal); totals with a
  full nutrient table; the favorite star; "I ate this again" (now, or another day and time);
  delete meal.
- **Item sheet:** grams slider over the model's low to high range plus free entry, portion
  buttons from the food's portions, count stepper, the matched food with "change" (search),
  the item's nutrients, delete. Changes save themselves.
- **Add food:** search, barcode scan (`BarcodeDetector` where available, a WASM ZXing build
  otherwise), label photo, recent and frequent foods, a new food of the person's own, Mealie
  recipes.
- **Favorites:** the person's starred meals, most recently used first; a tap logs a copy now.
- **Medicines:** the person's list (name, strength, form, usual amount, active ingredients,
  notes) with Photograph a label, Add a medicine, Log now and Edit; the history by day, where
  a logged dose's time and amount can be changed or the log removed. A short line says Kal
  records what was taken and does not check doses or interactions.
- **Move:** one day at a time (`/move?date=`, today without it, no days to come), with the
  previous and next day and the same sideways swipe as Today; a Monday-to-Sunday strip with a
  small steps ring per day (green once the step goal is reached, days to come outlined); the
  day's card with three rings against their goals, as the phone counts them (Kal for Android
  1.2, section 14): steps, active time and activity calories, then where they came from by app
  ("From Health Connect: Samsung Health") and "Last update from your phone 10:56; Samsung Health
  may already show more until the next one", then Kal's own workouts and the day's points. A
  day without the phone's numbers shows Move's steps and asks to update the app to 1.2 for the
  other two (or names Kal for Android without a phone). When the last update is more than two
  hours old for the shown day, a note says so, with "Open Kal's Health Connect screen" inside
  the app (Send now is there) or "How to set it up" in a browser. "That day" lists each
  activity's time, length, distance, source and points, with + Activity on this day; "Every day"
  lists the shown day's month, newest first, with the three numbers and small bars against the
  goals ("No data from the phone" for an empty day, "Earlier days" for the month before), and a
  row opens its day. The phone's numbers are shown next to Kal's workouts and never added to
  them: points, the streak and the WHO week count Kal's activities only. Below: the
  level and points, the streak (a day with 20 active minutes or 5,000 steps), the shown day's
  week by category against the weekly targets (WHO 2020: 150 minutes of moderate activity, a
  vigorous minute counting twice, and strength on 2 days; Kal's own steps goal, 7,000 a day
  unless changed in Settings, and an hour of mobility), eleven badges, and the last six weeks
  (folded). Points: 1 per moderate minute, 2 per vigorous minute, 1 per 2 light minutes, 5 per
  1,000 steps up to 15,000, and 15 per strength session (two a day). While a person's Health
  Connect steps come only from the phone's own step counter and nothing from Samsung Health has
  arrived, a hint says that a watch's steps come through Samsung Health and links to "How to
  fix it" on Kal for Android;
  closed once, it stays closed (`users.dismissed_hints`).
- **Source names:** wherever a source shows, Android's step counter
  (`com.android.healthconnect.phone.*`) is "Phone", known apps go by name (Samsung Health,
  Renpho, Google Fit, Fitbit, Garmin Connect, Strava), other packages are "another app", and
  the rest is openGym, "typed in Kal" or "imported from ..." (lib/contracts/activities.ts).
- **Body:** the latest weight with its chart and change over 30 days judged against the goal
  (better, steady, worse), body composition values, tape measurements compared with an earlier
  day, all weigh-ins; Log measurements with where to measure each part; the private health
  profile (conditions, allergies, notes, "Use in meal analysis" off by default); body photos by
  day.
- **Import a file:** a Samsung Health export (the zip or its CSV files), a Renpho CSV, or any
  CSV through a column-mapping step. The file is read on the device; only the records are sent.
- **Trends:** day, week and month views: energy and macros per day against targets, time of
  day, nutrients against their targets (consistently below or above), top foods; then
  Activity (steps, active time and activity calories a day and workouts; steps, active time and
  activity calories per day against their goals, and Kal's workout minutes per day by category,
  each with a table; the phone's day totals where Kal for Android sent them, Move's rules on the
  other days, with a caption that says how many days are the phone's; the WHO week line; days
  without data left out of the averages, not counted as zero) and "Eaten and burned" (the
  average eaten next to the activity calories); weight from Body
  (lib/trends/activity.ts). Above them, "Your year": a GitHub-style calendar of one calendar
  year (weeks as columns, Monday to Sunday as rows) for a measure of activity or a nutrient
  picked from a menu (Activity first: steps against the step goal, active minutes against a
  seventh of the WHO week with vigorous minutes counting twice, and energy from activity, both
  taken from the phone's day totals where it sent them, active minutes then against the active
  time goal; then
  the nutrients grouped like the catalogue, water from drinks under Other). Steps and active
  minutes are "more is better": under half the goal, under it, reached, one and a half times it
  or more, grey without data. Each day is coloured by its amount as a percent of
  the current target (no target history is kept): under 50, 50 to 85, 85 to 110 (on target),
  110 to 125, 125 to 150, over 150; grey without meals, outlined for days to come; a nutrient
  without a target is shaded against the year's highest day. A square opens the day's summary
  (words follow the kind of target: a minimum, a limit, a range). `?year=` and `?metric=` keep
  its state in the address (lib/trends/year.ts).
- **Plan meals:** meal plan suggestions from Mealie recipes (section 8).
- **Kal for Android:** the app's version and size, the download, linking Health Connect from
  inside the app, and the linked phones with Unlink, each with its recent updates and a warning
  while nothing has arrived (section 14).
- **Settings:** profile and targets (water goal included, and the goals of a day's steps,
  7,000, active time, 60 min, and activity calories, 500 kcal), units (metric default, imperial),
  time zone, cuisines, meal windows, notifications, AI (keys per provider, provider and model
  per task, test button, usage), integrations (Mealie, openGym), appearance (light, dark or the
  device's), export (JSON with everything, CSV of the meals), delete my data, account.
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
- Kal reads the account state (`GET /api/data`): weigh-ins become Body weights (and the latest
  one the weight for targets), and workouts (date, duration, exercises) become Move activities
  with an energy-burned estimate from MET values x body weight x duration, labelled as an
  estimate. Kal never writes to openGym.

**Files.** Samsung Health exports (steps, workouts, weigh-ins) and Renpho CSV files (weight and
body composition) are read in the browser (`lib/imports`); only the records are sent
(`POST /api/imports/activities`, `POST /api/imports/measurements`). Every record from elsewhere
(an import, openGym, Health Connect) keeps its source and the id it has there, so a second
import or sync updates it instead of adding a copy.

## 9. Notifications

Web Push with VAPID keys made on the server. Optional, off until the person turns it on:
"analysis ready" and "a question about your meal". Works in installed web apps on iOS 16.4
and later, Android and desktop browsers, and as the app's own notifications in Kal for
Android.

## 10. Data model (Postgres, Drizzle migrations)

- Accounts: users (profile, preferences, meal windows, notifications, closed hints), sessions,
  invites, reset_codes, rate_limits, audit_log.
- AI: ai_keys, ai_settings, ai_usage (tasks `analysis` and `matching`; medicine labels use the
  analysis settings).
- Meals: meals (user, client id, eaten_at, tz, local_date, slot, slot_locked, title, note,
  status, source photo, text, manual, mealie or duplicate, analysis JSON, analysis count,
  questions, corrections, error, totals, favorite times, timestamps, soft delete); meal_photos
  (meal, paths, size, sha256, order; the first is the cover); meal_items (meal, position,
  names, kind, emoji, food reference, grams, ml, portion, count, model estimate and range,
  confidence, edited flag, nutrients JSON, nutrient source, components).
- Food: foods (source, source id, owner, names in English and Persian, synonyms, category,
  brand, barcode, per-100 g nutrients JSON, density, search columns); food_portions;
  dish_components; nutrients; dri_targets; user_targets (edited targets, the water goal and
  Move's goals for steps, active time and activity calories);
  food_memory (user, normalised name, food, typical grams, count, last used).
- Medicines: medicines (the person's list), medicine_scans (label photos and what was read),
  medicine_logs (what was taken and when, with name, strength and form copied at the time).
- Move and Body: activities (category, type, time, duration, distance, steps, energy,
  intensity, source and external id); user_badges; body_measurements (code, unit, value,
  time, source and external id); health_profiles; body_photo_sessions and body_photos;
  heart_rates and sleep_sessions (from Health Connect); activity_day_totals (each day's steps,
  active time with how it was counted, and activity calories as the phone counts them, with the
  app that wrote most of each; one row per person, day and source, removed with its device
  row; unlinking keeps them like the other Health Connect records).
- Devices: devices (linked phones, hashed token, what each has sent), device_link_codes and
  health_connect_updates (each phone's update log: counts only, day totals included, kept 30
  days).
- Other: integrations (user, kind, encrypted credential, settings, last sync, status);
  push_subscriptions; jobs.

## 11. Stack

Next.js (App Router), React, TypeScript, Tailwind with a small component set (Radix
primitives), Drizzle with node-postgres, Postgres, `sharp`, `exifr` (photo times), `zxing-wasm`
(barcodes), Vitest, Playwright. Node on Alpine. The Android app (section 14) is Kotlin with
androidbrowserhelper (Trusted Web Activity), the Health Connect client and WorkManager.

## 12. Hosting and security

- Services: `app` (web), `worker` (jobs), `db` (Postgres, named volume), `egress` (Squid
  allowlist proxy), `tunnel` (Cloudflare connector). No published ports.
- Networks: tunnel net (tunnel and app, internal), backend net (app, worker, db, egress,
  internal), outbound nets only for egress and tunnel. App and worker reach the internet only
  through the proxy, which allows the three AI APIs, Open Food Facts, the FDC download host,
  the Mealie and openGym hosts, and the Web Push services.
- Every container: `cap_drop: ALL`, `no-new-privileges`, non-root, read-only root filesystem
  with small tmpfs, memory, CPU and PID limits, log rotation, pinned image versions.
- Photos on a bind-mounted folder; served only through an authenticated route that checks the
  owner. Upload limits (3 photos, 8 MB each after resizing, 25 MB per request), image type
  checked from content. The Android app's files are a read-only folder of the app container.
- Secrets: database password, the app secret that encrypts keys and tokens, VAPID keys and
  the tunnel token each in their own env file, generated on the server, locked by the start
  script, never printed.
- Server tool (`scripts/cal.mjs` in the container, wrapped by a PowerShell script): invite,
  reset, users, unlock, admin, disable, enable, invites, import-fdc, seed-dishes, vapid.
- Strict CSP, security headers, CSRF protection on mutations, rate limits on sign-in, upload,
  AI calls, imports and Health Connect batches.

## 13. Testing

- Unit: nutrient math, portion scaling, density, target formulas, matching ranks, meal names
  and the brunch rule, food emoji, water goals, Move points, streak and badges, body changes,
  file parsers, the year calendar (bins, grid, keyboard), design token contrast.
- Integration with Postgres: job queue (concurrency, retries), per-user isolation for every
  route, invite and lockout flows, importers on small fixture files, medicines and labels,
  favorites, meal photos, water, Move, Body, devices, Health Connect batches and the update
  log, the year, export.
- AI: the mock provider server replays recorded replies for all three providers, including
  errors, refusals, malformed JSON and timeouts.
- End to end (Playwright on Microsoft Edge in three projects: phone, desktop and phone in the
  dark theme; Chromium's fake camera and file upload; axe WCAG 2.1 AA checks and no sideways
  scroll on every screen): invite, sign-in, capture three photos, a meal in words with When,
  offline queue, analysis by the mock provider, edit an item, answer a question, barcode add,
  meal photos, favorites, medicines (label, Log as a medicine, changing a log), water entries,
  Move and file imports, Body and body photos, the year calendar, Kal for Android, Mealie log
  and plan (mock Mealie), openGym pairing (mock openGym), push.
- The README's screenshots come from a separate Playwright configuration
  (`playwright.screenshots.config.ts`, `pnpm run screenshots`) that fills a demo account with
  made-up data on the same throwaway stack; it is not part of the test run.
- An accuracy script (`scripts/eval.mjs`) the owner can run with their own key on their own
  weighed meals, reporting calorie and macro error per provider and model.
- Deployment checks (`deploy/test`): no published ports, non-root, read-only, egress only
  through the allowlist, secrets absent from images and logs, and a browser test against the
  real stack.

## 14. Kal for Android

An optional Android app (`android/`, built by `scripts/android-build.mjs` in Docker, never in
git) that opens Kal full screen as a Trusted Web Activity, so every web feature works and
updates with the server, and adds a native part that reads Health Connect, where Samsung
Health, a Galaxy watch and Renpho keep their records.

- **Getting it.** More, Kal for Android shows the version and size and downloads the APK
  (`/android/kal.apk`, signed in). `/android/version.json` is public for the app's update
  check, and `/.well-known/assetlinks.json` names the app id and certificate fingerprint from
  the server's settings.
- **Linking.** Inside the app, "Connect Health Connect" makes a one-time code (valid 10
  minutes) and opens the app's native screen, which trades it for a device token (stored hashed
  on the server, encrypted with an Android Keystore key on the phone) and asks Health Connect
  for read access. The page lists the linked phones with Unlink.
- **Sync.** About every hour in the background, and when the app opens, the phone sends batches
  (`POST /api/health-connect/sync`, at most 2 MB and 120 batches an hour per phone): steps as
  day totals, workouts (Move activities, which also raise the water goal), weight and body
  composition (Body), resting heart rate and sleep (kept for later charts). Every record keeps
  its Health Connect id, so sending it again updates it and a deletion on the phone removes it.
  Every sync sends at least one batch, and a read of the whole window (the first, or again after
  access changed) says how many days it covered.
- **Day totals (app 1.2).** For every day a sync reads (each day of a first read; later the days
  a change touched, today and yesterday) the phone also sends the day's steps (Health
  Connect's aggregate), activity calories (the aggregate of active calories burned) and active
  time, which Health Connect does not keep: the minutes of the day covered by exercise
  sessions, joined with the minutes of step records walked at 60 steps a minute or more (a
  record's steps spread evenly over its time), each minute once, within the phone's local day
  (method `sessions+steps60`). Each number names the app that wrote most of it. The server keeps
  one row per day (a day sent with every number at 0 is removed); apps 1.0 and 1.1 keep working
  without them. The first sync after updating reads the whole window again, so earlier days
  get their totals too. Move, Today, Trends and the year show them as the phone's numbers.
- **Update log.** The server notes each accepted batch (`health_connect_updates`): when, the
  app's version, how many records of each kind it held, what was stored, and whether there was
  nothing to store; counts only (the one number kept is the phone's step total for that day).
  Kept 30 days, removed when the phone is unlinked, in the export and in Delete my data. The
  page lists each phone's ten latest updates in words ("6,812 steps today · 1 workout · 1
  weigh-in", "Nothing new", "First read, 30 days: Health Connect was empty") and warns
  "Nothing has arrived yet", with how to make Samsung Health and Renpho share, while a phone has
  sent updates and no Health Connect record of the person is stored. The same steps are
  reachable at `/more/android#how-to-fix` at any time (Move's hint links there).
- **On the phone.** The app's Health Connect screen shows today's steps, active time and
  activity calories as last sent (app 1.2; Move's note opens it with `kal://status`), and counts
  what Health Connect holds for the
  last 30 days (days with steps, workouts, days with resting heart rate, nights of sleep,
  weigh-ins) with the apps that wrote them; this list is never sent. When every kind it may read
  is empty it says "Health Connect has nothing to share yet", whether Samsung Health and Renpho
  Health are installed, opens Samsung Health or Health Connect's settings, and lists the steps.

## 15. Not in this version

An iPhone app and Apple Health; image embeddings for photo similarity; a local vision model;
server-side speech-to-text; a history of targets (the year compares every day with the current
targets).
