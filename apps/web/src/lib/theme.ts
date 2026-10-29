export const THEME_COOKIE = "theme";
export type Theme = "light" | "dark" | "system";

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
