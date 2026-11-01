// The light or dark choice from Settings, kept in a cookie so the server renders the right theme
// without an inline script. "system" follows the device.
export const THEME_COOKIE = "cal_theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const parseTheme = (value: string | undefined): Theme =>
  (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
