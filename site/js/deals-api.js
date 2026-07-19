const DEALS_API_URL =
  'https://voorraadkast-deals.karsmorsink.workers.dev';

export const DEFAULT_RETAILERS = [
  'albert_heijn',
  'dirk',
  'lidl',
  'hoogvliet',
  'plus',
];

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_PREFIX = 'voorraadmaat-live-deals:';

export async function searchDeals(
  query,
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { query: '', count: 0, items: [] };

  const normalizedRetailers = normalizeRetailers(retailers);
  const cacheKey = `${CACHE_PREFIX}${cleanQuery.toLowerCase()}|${normalizedRetailers.join(',')}`;

  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const url = new URL(`${DEALS_API_URL}/search`);
  url.searchParams.set('q', cleanQuery);

  for (const retailer of normalizedRetailers) {
    url.searchParams.append('retailer', retailer);
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.details ||
      payload.error ||
      `Deal search failed: ${response.status}`
    );
  }

  const result = {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : [],
  };

  writeCache(cacheKey, result);
  return result;
}

export async function searchShoppingListDeals(
  shoppingItems,
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const queries = [...new Set(
    shoppingItems
      .map((item) =>
        typeof item === 'string'
          ? item
          : item.key || item.name || item.product || item.label
      )
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];

  const normalizedRetailers = normalizeRetailers(retailers);
  if (!queries.length) {
    return {
      retailers: normalizedRetailers,
      retrievedAt: new Date().toISOString(),
      results: [],
    };
  }

  const results = [];

  // Individual cached searches are more resilient than one large batch call.
  for (const query of queries.slice(0, 30)) {
    try {
      const response = await searchDeals(query, normalizedRetailers, { force });
      results.push({
        query,
        count: response.items.length,
        items: response.items,
      });
    } catch (error) {
      results.push({
        query,
        count: 0,
        items: [],
        error: String(error?.message || error),
      });
    }
  }

  return {
    retailers: normalizedRetailers,
    retrievedAt: new Date().toISOString(),
    results,
  };
}

export function clearDealsCache() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage is optional; live deal search still works without it.
  }
}

function normalizeRetailers(retailers) {
  const allowed = new Set(DEFAULT_RETAILERS);
  return [...new Set(
    (Array.isArray(retailers) ? retailers : DEFAULT_RETAILERS)
      .map(String)
      .filter((retailer) => allowed.has(retailer))
  )];
}

function readCache(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (!stored || Date.now() - stored.savedAt > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return stored.value;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      value,
    }));
  } catch {
    // Ignore storage limits or private-mode restrictions.
  }
}
