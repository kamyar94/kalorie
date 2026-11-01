# Cal

Cal is a self-hosted, photo-first food log. Take one to three photos of what you eat and press
Send. The server works out the foods, amounts, calories and nutrients, files the meal by time,
and lets you review and correct every detail. It installs as an app on phones, tablets and
desktops, and accounts are by invitation only.

Created by Kamyar Fatemifar.

## What it does

- **Capture in one tap.** An in-app camera (or the photo picker), up to three photos per meal,
  the capture time taken from the photo, and an offline queue that sends meals when the device
  is back online.
- **The AI recognises, the database counts.** A vision model names the foods and estimates the
  amounts; nutrients come from USDA FoodData Central (Foundation Foods, SR Legacy and FNDDS,
  imported locally), Open Food Facts for barcodes, and a set of composite dishes. The model's
  own nutrient guess is used only when nothing matches, and is labelled as such.
- **Every detail is editable.** Names, grams, portions, counts and every nutrient, with totals
  that update at once. Corrections are remembered and reused next time.
- **Your own AI key.** Each person chooses OpenAI, Anthropic or Google and saves their own key,
  which is stored encrypted.
- **Targets and trends.** Daily targets from the person's profile, and day, week and month views.
- **Integrations (optional).** [Mealie](https://github.com/mealie-recipes/mealie) for today's
  meal plan, recipes as foods and plan suggestions; [openGym](https://github.com/DuarteSantos8/openGym)
  for body weight and workouts. Cal only reads from openGym, and writes to Mealie only when you
  confirm.
- **Notifications (optional).** Web Push when an analysis is ready or Cal has a question.

The full design is in [docs/DESIGN.md](docs/DESIGN.md).

## Running it

Cal runs as a hardened Docker stack: the web app, a background worker, Postgres, an egress proxy
that allows only the services Cal needs, and a Cloudflare Tunnel connector, with no published
ports. [deploy/README.md](deploy/README.md) covers the first start, updates, backups and
troubleshooting.

## Development

Node 24 and pnpm 11 (through corepack), plus Docker for the test database.

```
corepack pnpm install
corepack pnpm run dev           # web app on 127.0.0.1:3201
corepack pnpm run worker:dev    # background worker
corepack pnpm run check         # typecheck, lint, unit and integration tests
corepack pnpm run test:e2e      # Playwright end-to-end tests
```

Settings for development are described in [.env.example](.env.example).

## License

Cal is published under the [KF Source-Available License 1.0](LICENSE.md). You may read it,
download it, fork it and run it privately for yourself; deploying it for others, changing it or
using it commercially needs written permission. It is not an open-source license.

Third-party material keeps its own license: the npm packages Cal depends on; USDA FoodData
Central data (public domain), including the small extracts in `tests/fixtures/fdc`; and Open
Food Facts data (Open Database License), including the recorded replies in
`tests/fixtures/off`.
