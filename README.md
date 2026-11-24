# Kal

Kal is a self-hosted, photo-first food log. Take a photo of what you eat, or describe it in a
sentence, and press Send. The server works out the foods, amounts, calories and nutrients, files
the meal by time, and lets you review and correct every detail. Around the meals, Kal keeps your
water, medicines, activity and body measurements, and shows how your days add up over a whole
year. It installs as an app on phones, tablets and desktops, with an optional Android app that
reads Health Connect, and accounts are by invitation only.

Created by Kamyar Fatemifar.

## Screenshots

<table>
  <tr>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/today-dark.webp">
        <img src="docs/screenshots/today-light.webp" width="200" alt="Today: a ring with 1,790 of 1,859 kcal eaten, protein, carbs and fat bars, and the Water card at 1.95 of 1.9 litres with the day's glasses and drinks">
      </picture>
      <br><sub>Today</sub>
    </td>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/today-meals-dark.webp">
        <img src="docs/screenshots/today-meals-light.webp" width="200" alt="Today's meals: favorites to log again, then the timeline with a typed breakfast drawn as a plate of food emoji, glasses of water, a snack, and a photographed lunch waiting for an answer">
      </picture>
      <br><sub>The day's meals</sub>
    </td>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/meal-dark.webp">
        <img src="docs/screenshots/meal-light.webp" width="200" alt="A meal page: Koobideh with rice at 13:10, lunch, with its photo, the cover photo marked, an Add photo button and the Update items from the photos switch">
      </picture>
      <br><sub>A meal and its photos</sub>
    </td>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/meal-details-dark.webp">
        <img src="docs/screenshots/meal-details-light.webp" width="200" alt="The same meal further down: a question with suggested answers, the Fix with a sentence field, and the items with their emoji, amounts and calories">
      </picture>
      <br><sub>Questions, fixes and items</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/camera-text-dark.webp">
        <img src="docs/screenshots/camera-text-light.webp" width="200" alt="The camera in words: What did you eat? with a typed breakfast, and the When chip set to yesterday at 08:15">
      </picture>
      <br><sub>A meal in words, with When</sub>
    </td>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/move-dark.webp">
        <img src="docs/screenshots/move-light.webp" width="200" alt="Move for one day: the day pager, a week strip with a steps ring per day, the day's steps against the goal with active minutes, energy and points, where the steps came from, and the day's activities">
      </picture>
      <br><sub>Move</sub>
    </td>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/body-dark.webp">
        <img src="docs/screenshots/body-light.webp" width="200" alt="Body: weight 66.4 kg, 0.8 kg down in 30 days, with its chart, body fat, muscle and body water, and the tape measurements compared with a month ago">
      </picture>
      <br><sub>Body</sub>
    </td>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/medicines-dark.webp">
        <img src="docs/screenshots/medicines-light.webp" width="200" alt="Medicines: Photograph a label, Add a medicine, and three medicines with their active ingredients, each with Log now and Edit">
      </picture>
      <br><sub>Medicines</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/trends-dark.webp">
        <img src="docs/screenshots/trends-light.webp" width="200" alt="Trends: Your year, a calendar of coloured squares, one a day, for calories against the target, with its legend and counts, above the week's averages">
      </picture>
      <br><sub>Trends: your year</sub>
    </td>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/trends-day-dark.webp">
        <img src="docs/screenshots/trends-day-light.webp" width="200" alt="A day's summary from the year: 1,703 kcal, 92 percent of the target, on target, with protein, carbs and fat, meals, water and steps">
      </picture>
      <br><sub>A day of the year</sub>
    </td>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/android-dark.webp">
        <img src="docs/screenshots/android-light.webp" width="200" alt="Kal for Android: the app's version and size, Download the app, and how to install it and connect Health Connect">
      </picture>
      <br><sub>Kal for Android</sub>
    </td>
    <td></td>
  </tr>
</table>

<img src="docs/screenshots/desktop-trends-light.webp" alt="Trends on a wide screen: the whole year as a calendar of days coloured against the calorie target, the legend with its percent ranges, and the week's averages and calories per day below">

The screenshots show made-up demo data (`corepack pnpm run screenshots` makes them again) and
follow your light or dark theme.

## What it does

### Logging a meal

- **A photo or a sentence.** The in-app camera (or the photo picker) takes up to three photos
  per meal, with the time taken from the photo. **Type** turns the camera into a text box for a
  meal in words ("two boiled eggs, a tomato and a cup of tea"), and the microphone dictates. An
  offline queue sends meals when the device is back online.
- **Add photos.** Pick many photos at once, for example a whole day of meals, from Today (or
  more than three in the camera's Gallery). On the device Kal reads when each was taken and
  compares how they look, then sorts them into meals of up to three photos. Check each meal's
  time and add a note, move photos between meals by dragging them (touch and hold on a phone) or
  with "Move to…", then add them all; each goes through the upload queue and is analysed like any
  photo meal.
- **When.** The chip at the top of the camera says when you ate: now, half an hour or a few
  hours ago, this morning, yesterday, or any day and time in the last year. A meal's **Time**
  button changes it afterwards.
- **Without the camera.** Add food searches the food tables, scans a barcode, reads a photo of
  a nutrition label, lists your recent and frequent foods, and keeps foods you make yourself.
- **Favorites.** Star a meal and log it again from Today with one tap; "I ate this again"
  copies a meal to another day.
- **What should I eat?** On Today and on the camera: what is left of today's energy, protein
  and fiber and the room under sodium, the meal you usually have at this hour and how big, and
  the three meals you have had that fit best now (favorites and the last 90 days, never more
  than what is left, recent ones spaced out), each logged again with one tap. With your own AI
  key, "Something new" asks it for one idea that fits the same numbers.

### What Kal works out

- **The AI recognises, the database counts.** A vision model names the foods and estimates the
  amounts; nutrients come from USDA FoodData Central (Foundation Foods, SR Legacy and FNDDS,
  imported locally), Open Food Facts for barcodes, and a set of composite dishes. The model's
  own nutrient guess is used only when nothing matches, and is labelled as such.
- **Questions, then a sentence.** When something matters for the numbers, Kal asks at most two
  short questions with suggested answers. **Fix with a sentence** takes a correction ("it was
  chicken, not beef", "I ate only half the rice") and analyses the meal again, keeping the
  changes you made by hand unless you ask otherwise.
- **Every detail is editable.** Names, grams, portions, counts, the matched food and every
  nutrient, with totals that update at once. Corrections are remembered and reused next time.
- **Food emoji and plates.** Each item gets an emoji, and a meal without a photo is drawn as a
  plate of its foods.
- **Meal names.** Breakfast, brunch, lunch, dinner, supper, snack, drink or dessert, from the
  time of day (your meal windows), the food and your own words; a name you pick by hand stays.
- **Meal photos.** Add or remove photos later and choose the cover. "Update items from the
  photos" (off unless you turn it on) analyses the meal again with the new photos.

### Water

Drinks in your meals count towards the day's water; alcohol does not. **+ Glass**, **+ Bottle**
and **+ Other amount** add water on its own, the Water card lists the day's entries, and a sheet
changes an entry's amount and time. The daily goal follows EFSA's advice (1.6 L for women, 2.0 L
for men, 1.8 L without a sex in the profile, or your own) and grows by about 0.5 L for each hour
of moderate or harder activity that day, up to 1.5 L more.

### Medicines

The camera's **Medicine** mode photographs a box or blister and your AI provider reads the name,
strength, form and active ingredients from the label. Your medicines stay in a list; **Log now**
on Today records a dose, and a logged medicine's time and amount can be changed from Today, the
Medicines page or the notice after Log now. A medicine photographed as a meal by mistake is
offered **Log as a medicine**. Kal records what you took; it does not check doses or
interactions.

### Move

Activities in six categories (cardio, strength, walking, mobility, sports, other), typed in Kal,
read from openGym, imported from a Samsung Health export (read on the device; only the records
are sent to your server) or sent by Kal for Android from Health Connect. Move shows one day at
a time: a week strip of steps; the day's steps, active time and activity calories in three
rings against their goals, as your phone counts them (the numbers Samsung Health shows), with
where they came from ("Samsung Health", "Phone") and when the phone last sent; Kal's own
workouts and points next to them; the day's activities; and every day of the month with the
same three numbers. The previous and next day are a swipe away. Points, levels, a streak (a
day with 20 active minutes or 5,000 steps), weekly targets after the WHO guidance (150 minutes
of moderate activity, strength on two days) with Kal's own steps and mobility targets, and
eleven badges.

### Body

Weight and body composition from a scale (typed, from Health Connect, a Renpho or Samsung
Health export, or openGym), tape measurements with where to measure, and every change judged
against your goal. A private health profile holds conditions, allergies and notes. Guided
front, left, back and right photos are kept on your server for comparing over time.

### Targets and Trends

Daily targets come from your profile (Mifflin-St Jeor energy, protein by body weight, the US
Dietary Reference Intakes for vitamins and minerals), and every target can be edited. Trends
shows days, weeks and months: calories, protein, carbs and fat per day against the targets, the
time of day you eat, every nutrient against its target, top foods, your activity (steps, active
time and activity calories per day against their goals, workouts, the WHO week, and what you
ate next to what activity burned), and weight. The goals for steps, active time and activity
calories are edited with the other targets.

**Most and least nutritious** lists the meals of the period, or of all time, with the highest
and lowest balance score: 0 to 100 for how nutritious a meal is for its size (nine nutrients to
encourage and three to limit against your targets, after the Nutrient Rich Foods index NRF9.3)
and how well its size fits that kind of meal. Each meal's page shows its score with every
nutrient against the meal's share of your day.

**Your year** is a calendar of the year, one square a day, coloured by how the day compares
with its target: steps, active minutes or energy from activity, calories, any other nutrient
Kal tracks, or water from drinks. A square opens the day's summary, and the arrows go back to
earlier years.

### Kal for Android (optional)

The same Kal in an Android app that also reads Health Connect, where Samsung Health, a Galaxy
watch and Renpho keep steps, workouts, heart rate, sleep and weigh-ins, and sends them to your
server. It is linked with a one-time code and can be unlinked at any time. It is built from
[android/](android/README.md) and downloaded from your own server (More, then Kal for Android),
not a store, and the page offers each newer version.

From version 1.2 the app also sends each day's steps, active time and activity calories, and
its Health Connect screen shows today's three numbers. Active time is not kept by Health
Connect, so the app works it out: the minutes covered by workouts and by walking at 60 steps a
minute or more, each minute once.

The app's Health Connect screen lists what Health Connect holds for the last 30 days (days with
steps, workouts, resting heart rate, sleep, weigh-ins) and which app wrote each, counted on the
phone and never sent. When nothing is there, it says so and opens Samsung Health or Health
Connect's permissions directly. On the server, Kal keeps a 30-day log of each update a phone sends
(counts only), shows the latest ones under the phone, and warns with the steps to fix it while
nothing has arrived.

### Integrations (optional)

[Mealie](https://github.com/mealie-recipes/mealie) for today's meal plan, recipes as foods and
plan suggestions; [openGym](https://github.com/DuarteSantos8/openGym) for body weight and
workouts. Kal only reads from openGym, and writes to Mealie only when you confirm.

### Notifications (optional)

Web Push when an analysis is ready or Kal has a question about a meal.

### Your own AI key

Each person chooses OpenAI, Anthropic or Google and saves their own key, which is stored
encrypted. The provider and model can be set per task, and Settings shows the last 30 days of
usage. Saving a key retries the recent meals that stopped for want of one.

### Privacy

- Accounts are by invitation, and each person sees only their own data. Admins see usage
  totals, never anyone's meals, photos or health data.
- Photos are resized on the device, which drops their metadata (no location leaves the phone).
  They stay on your server except for the analysis call to the AI provider you chose. Sorting
  many photos into meals (Add photos) compares their look on the device; that comparison is
  never sent or stored.
- Body photos are never sent to an AI. The health profile is private and goes with meal
  analyses only when you turn on "Use in meal analysis".
- Settings exports your data (everything as JSON, the meals as CSV), and "Delete my data"
  removes it.

The full design is in [docs/DESIGN.md](docs/DESIGN.md).

## Running it

Kal runs as a hardened Docker stack: the web app, a background worker, Postgres, an egress proxy
that allows only the services Kal needs, and a Cloudflare Tunnel connector, with no published
ports. [deploy/README.md](deploy/README.md) covers the first start, updates, backups, the Android
app and troubleshooting.

## Development

Node 24 and pnpm 11 (through corepack), plus Docker for the test database.

```
corepack pnpm install
corepack pnpm run dev           # web app on 127.0.0.1:3201
corepack pnpm run worker:dev    # background worker
corepack pnpm run check         # typecheck, lint, unit and integration tests
corepack pnpm run test:e2e      # Playwright end-to-end tests (Microsoft Edge)
corepack pnpm run screenshots   # the README's screenshots, from made-up data
```

Settings for development are described in [.env.example](.env.example).

## License

Kal is published under the [KF Source-Available License 1.0](LICENSE.md). You may read it,
download it, fork it and run it privately for yourself; deploying it for others, changing it or
using it commercially needs written permission. It is not an open-source license.

Third-party material keeps its own license: the npm packages Kal depends on; USDA FoodData
Central data (public domain), including the small extracts in `tests/fixtures/fdc`; and Open
Food Facts data (Open Database License), including the recorded replies in
`tests/fixtures/off`.
