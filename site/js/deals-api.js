const DEALS_API_URL =
  'https://voorraadkast-deals.karsmorsink.workers.dev';

export const DEFAULT_RETAILERS = [
  'albert_heijn',
  'dirk',
  'lidl',
  'hoogvliet',
  'plus',
];

export const DEAL_CATEGORIES = [
  { slug: 'all', label: 'Alle categorieën' },
  { slug: 'groente-fruit', label: 'Groente & Fruit' },
  { slug: 'zuivel-eieren', label: 'Zuivel & Eieren' },
  { slug: 'vega-plantaardig', label: 'Vega & Plantaardig' },
  { slug: 'kaas-vleeswaren', label: 'Kaas & Vleeswaren' },
  { slug: 'vlees-gevogelte', label: 'Vlees & Gevogelte' },
  { slug: 'vis-zee-vruchten', label: 'Vis & Zeevruchten' },
  { slug: 'brood-bakkerij', label: 'Brood & Bakkerij' },
  { slug: 'ontbijt-beleg', label: 'Ontbijt & Beleg' },
  { slug: 'pasta-rijst-wereldkeuken', label: 'Pasta, Rijst & Wereldkeuken' },
  { slug: 'soepen-conserven-sauzen', label: 'Soepen, Conserven & Sauzen' },
  { slug: 'snoep-koek-chips', label: 'Snoep, Koek & Chips' },
  { slug: 'frisdrank-sappen', label: 'Frisdrank & Sappen' },
  { slug: 'koffie-thee', label: 'Koffie & Thee' },
  { slug: 'bier-wijn-dranken', label: 'Bier, Wijn & Dranken' },
  { slug: 'diepvries', label: 'Diepvries' },
  { slug: 'huishouden-dier', label: 'Huishouden & Dier' },
  { slug: 'drogisterij-baby', label: 'Drogisterij & Baby' },
  { slug: 'overig', label: 'Overig' },
];

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_PREFIX = 'voorraadmaat-top-deals-v6:';

export async function loadTopDeals(
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const normalizedRetailers = normalizeRetailers(retailers);
  const cacheKey = `${CACHE_PREFIX}${normalizedRetailers.join(',')}`;

  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const url = new URL(`${DEALS_API_URL}/top`);

  for (const retailer of normalizedRetailers) {
    url.searchParams.append('retailer', retailer);
  }

  const payload = await requestJson(url);
  const result = {
    type: 'top',
    mode: 'top-only',
    retailers: Array.isArray(payload.retailers)
      ? payload.retailers
      : normalizedRetailers,
    count: Number.isFinite(payload.count)
      ? payload.count
      : Array.isArray(payload.items)
        ? payload.items.length
        : 0,
    items: Array.isArray(payload.items) ? payload.items : [],
    attempts: Array.isArray(payload.attempts) ? payload.attempts : [],
    hasMore: false,
    retrievedAt: payload.retrievedAt || new Date().toISOString(),
  };

  writeCache(cacheKey, result);
  return result;
}

export function clearDealsCache() {
  try {
    const keys = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }

    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Live loading still works if localStorage is unavailable.
  }
}

async function requestJson(url) {
  let response;

  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (error) {
    throw new Error(
      `De topaanbiedingen konden niet worden bereikt. ${getErrorMessage(error)}`
    );
  }

  const payload = await response.json().catch(() => null);

  if (!payload) {
    throw new Error('De aanbiedingenservice gaf geen geldige JSON terug.');
  }

  if (!response.ok) {
    throw new Error(
      payload.details ||
        payload.error ||
        `De aanbiedingenservice gaf status ${response.status}.`
    );
  }

  return payload;
}

function normalizeRetailers(retailers) {
  const allowed = new Set(DEFAULT_RETAILERS);
  const values = Array.isArray(retailers) ? retailers : DEFAULT_RETAILERS;

  const normalized = [
    ...new Set(
      values
        .map((value) => String(value || '').trim())
        .filter((retailer) => allowed.has(retailer))
    ),
  ];

  return normalized.length ? normalized : [...DEFAULT_RETAILERS];
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const cached = JSON.parse(raw);

    if (!cached?.savedAt || !cached?.value) {
      localStorage.removeItem(key);
      return null;
    }

    if (Date.now() - cached.savedAt > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return cached.value;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        value,
      })
    );
  } catch {
    // Ignore storage restrictions and quota limits.
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
