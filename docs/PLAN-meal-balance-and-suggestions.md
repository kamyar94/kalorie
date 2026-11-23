# Plan: meal balance in Trends, and "What should I eat?"

Status: planned, being built. This file describes the two features before they land; the
finished behaviour moves into [DESIGN.md](DESIGN.md) when they ship.

## 1. Most and least nutritious meals (Trends)

"Nutritious" means overall nutritional value for the meal's size, not simply more or less of
something. Every meal gets a **balance score from 0 to 100** with a short reason, built from two
parts:

- **Nutrient density**, after the Nutrient Rich Foods index NRF9.3 (Drewnowski and Fulgoni): nine
  nutrients to encourage (protein, fibre, vitamins A, C and E, calcium, iron, potassium,
  magnesium) and three to limit (saturated fat, added sugar, sodium), each against the person's
  own targets in Kal, per energy, with every encouraged nutrient capped at its target so one
  very rich nutrient cannot hide the others.
- **Portion fit**: the meal's energy against the usual share of the day for its kind of meal
  (a main meal around a quarter to a third of the day, a snack around a tenth), so a meal that is
  far too big or far too small loses points.

Trends shows, for the chosen period and for all time, the three meals with the highest and the
three with the lowest score, each with its score, its plate or photo, and the reason ("plenty of
protein and fibre, little sodium" or "sugar twice its share, little fibre"). A meal opens on tap;
its page shows the score with the breakdown.

## 2. "What should I eat?"

A button on Today (and on the camera screen) opens a suggestion for right now:

- **What is left today**: energy and the main nutrients still open against today's targets,
  after what was already eaten, and how much is usually still eaten after this hour.
- **The person's own pattern**: from the last weeks, what kind and size of meal they usually have
  at this time of day (for example a 600 kcal lunch around 13:00, a small snack around 16:00).
- **Meals they already had come first**: favorites and past meals are ranked by how well they
  fill what is left and fit the usual size at this hour, without going over the day's energy or
  the limits (sodium, added sugar, saturated fat). Recent repeats are spaced out.

The sheet shows the top three, each with the reason ("covers 35 g of the protein you still need,
fits your usual lunch") and **Log this**, which logs it like a favorite at the current time.
Everything is worked out on the server from the person's own data; no AI is needed. An optional
"Something new" can ask the person's own AI provider for one idea that fits the same numbers.
