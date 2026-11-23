import type { ModelCatalogPreset } from "./model-catalog";
import { ContextWindowError, parseContextWindow } from "./model-context";

/** The local catalog endpoint receives identifiers, never provider credentials. */
export async function importPresets(ids: string[], provider: string, baseUrl?: string) {
  const presets = new Map<string, ModelCatalogPreset>();
  let failed = 0;
  for (let start = 0; start < ids.length; start += 300) {
    const batch = ids.slice(start, start + 300);
    try {
      const response = await fetch("/api/models-config/catalog", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch, provider, baseUrl }), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: { presets: { id: string; preset: ModelCatalogPreset }[] } = await response.json();
      for (const { id, preset } of data.presets) presets.set(id, preset);
    } catch {
      // Keep discovery metadata when offline; don't repeat the same outage for each remaining batch.
      failed = ids.length - start;
      break;
    }
  }
  return { presets, failed };
}

// A provider's default context window for the models imported into it.
//
// The models editor keeps it in its draft, on the provider it belongs to
// (IMPORT_CONTEXT_KEY), so that a rename or a removal of the provider takes it
// along and Save writes it with everything else. It is not written to
// models.json, which is pi's file and pi's schema: it is merged in after the
// editor loads models.json and split off before it saves, into a file of the
// fork's own (lib/model-import-defaults.ts).

export const IMPORT_CONTEXT_KEY = "piWebImportContextWindow";
const DEFAULTS_URL = "/api/models-config/import-defaults";

type Providers = Record<string, Record<string, unknown>>;
interface WithProviders { providers?: Record<string, object> }

/** A whole number of tokens, typed or stored; undefined for anything else. */
export function parseImportContextWindow(value: unknown): number | undefined {
  const parsed = parseContextWindow(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** The defaults of a draft, by provider. A draft with one that is no token count is refused, naming its provider. */
export function importContextWindows(config: WithProviders): Record<string, number> {
  const defaults: Record<string, number> = {};
  for (const [providerId, provider] of Object.entries((config.providers ?? {}) as Providers)) {
    if (!provider || typeof provider !== "object" || !Object.hasOwn(provider, IMPORT_CONTEXT_KEY)) continue;
    const value = parseImportContextWindow(provider[IMPORT_CONTEXT_KEY]);
    if (value === undefined) throw new ContextWindowError(providerId);
    defaults[providerId] = value;
  }
  return defaults;
}

/** The draft as models.json gets it: without the defaults. */
export function withoutImportDefaults<T extends WithProviders>(config: T): T {
  if (!config.providers) return config;
  const providers = Object.fromEntries(Object.entries(config.providers as Providers).map(([providerId, provider]) => {
    if (!provider || typeof provider !== "object" || !Object.hasOwn(provider, IMPORT_CONTEXT_KEY)) return [providerId, provider];
    const rest = { ...provider };
    delete rest[IMPORT_CONTEXT_KEY];
    return [providerId, rest];
  }));
  return { ...config, providers };
}

/**
 * models.json as the editor's draft has it: each provider with its stored
 * default. A default an earlier build left in models.json itself stays in the
 * draft, so the next Save moves it. A failed read leaves the draft without
 * defaults, never without its providers.
 */
export async function withImportDefaults<T extends WithProviders>(config: T): Promise<T> {
  if (!config.providers) return config;
  let stored: Record<string, unknown> = {};
  try {
    const response = await fetch(DEFAULTS_URL, { cache: "no-store" });
    const data: { contextWindows?: Record<string, unknown> } = await response.json();
    if (response.ok && data.contextWindows && typeof data.contextWindows === "object") stored = data.contextWindows;
  } catch {
    return config;
  }
  const providers = Object.fromEntries(Object.entries(config.providers as Providers).map(([providerId, provider]) => (
    provider && typeof provider === "object" && Object.hasOwn(stored, providerId)
      ? [providerId, { ...provider, [IMPORT_CONTEXT_KEY]: stored[providerId] }]
      : [providerId, provider]
  )));
  return { ...config, providers };
}

/** Writes the draft's defaults: those of its providers, and no others. */
export async function saveImportDefaults(config: WithProviders): Promise<void> {
  const response = await fetch(DEFAULTS_URL, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contextWindows: importContextWindows(config) }),
  });
  if (response.ok) return;
  let detail = "";
  try { detail = ((await response.json()) as { error?: string }).error ?? ""; } catch { /* The status says enough. */ }
  throw new Error(detail || `HTTP ${response.status}`);
}
