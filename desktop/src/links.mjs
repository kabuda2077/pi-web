const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Whether url is a page of the local server at origin. */
export function isAppUrl(url, origin) {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The url to hand to the OS for a link that leaves the app, or null when it
 * must not be opened. Chat text comes from a model, so only web and mail links
 * reach the OS: any other scheme could start an arbitrary registered program.
 */
export function externalUrl(url) {
  try {
    const parsed = new URL(url);
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The part of an app url worth reopening on the next launch, or null. */
export function restorablePath(url, origin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return null;
    if (parsed.pathname === "/login" || parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
