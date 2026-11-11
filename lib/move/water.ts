// The day's water goal raised by timed activity (board 9). Sweating adds to what a person needs to
// drink; how much varies widely with the person, the effort and the weather (American College of
// Sports Medicine position stand "Exercise and fluid replacement", Sawka et al., Medicine &
// Science in Sports & Exercise 2007;39(2):377-390, which advises drinking to replace sweat
// losses). Kal adds a modest estimate: about 0.5 L per hour of moderate or harder activity,
// prorated by the minute, rounded to 0.1 L and capped at 1.5 L a day. Plain functions.

export const ACTIVITY_WATER = {
  mlPerHour: 500,
  maxMl: 1500,
  stepMl: 100,
} as const;

/** Extra millilitres for `minutes` of moderate or harder activity. */
export const activityWaterMl = (minutes: number) => {
  if (!(minutes > 0)) return 0;
  const raw = (minutes / 60) * ACTIVITY_WATER.mlPerHour;
  return Math.min(
    ACTIVITY_WATER.maxMl,
    Math.round(raw / ACTIVITY_WATER.stepMl) * ACTIVITY_WATER.stepMl,
  );
};

/** The day's goal: the hydration target and the activity estimate. */
export const dayWaterGoalMl = (baseMl: number, sweatMinutes: number) =>
  baseMl + activityWaterMl(sweatMinutes);
