// Whether this tab runs inside the Kal Android app (see "Inside the app" in
// lib/contracts/android.ts). Browser only.
import {
  APP_COOKIE,
  appMarkerFromParams,
  NOT_IN_APP,
  parseAppMarker,
  type AppContext,
} from "@/lib/contracts/android";

const STORAGE_KEY = "kal.android-app";

const readCookie = () =>
  document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${APP_COOKIE}=`))
    ?.slice(APP_COOKIE.length + 1) ?? null;

const store = (value: string) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage off: the page shows the browser's buttons, which still work.
  }
};

/**
 * Keeps the app's marker for this tab: from the address (?source=android-app), from the cookie
 * the proxy set, or from the referrer Android gives an app's pages. The cookie is removed.
 */
export const rememberAppContext = () => {
  const fromUrl = appMarkerFromParams(new URLSearchParams(location.search));
  const fromCookie = readCookie();
  const marker = fromUrl ?? (parseAppMarker(fromCookie) ? fromCookie : null);
  if (marker) store(marker);
  if (fromCookie !== null) document.cookie = `${APP_COOKIE}=; path=/; max-age=0; samesite=lax`;
  if (!marker && document.referrer.startsWith("android-app://")) {
    let known: string | null = null;
    try {
      known = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      known = null;
    }
    if (!known) store("android.1.0");
  }
};

/** This tab's context: in the app or in a browser. */
export const readAppContext = (): AppContext => {
  try {
    return parseAppMarker(sessionStorage.getItem(STORAGE_KEY)) ?? NOT_IN_APP;
  } catch {
    return NOT_IN_APP;
  }
};
