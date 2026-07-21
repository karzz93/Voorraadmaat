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
const CACHE_PREFIX = 'voorraadmaat-live-deals:';

export async function loadDealFeed({
  retailers = DEFAULT_RETAILERS,
  category = 'all',
  cursor = '',
  force = false,
} = {}) {
  const normalizedRetailers = normalizeRetailers(retailers);
  const normalizedCategory = normalizeCategorySlug(category);
  const cacheKey = [
    CACHE_PREFIX,
    'feed',
    normalizedCategory,
    cursor || 'start',
    normalizedRetailers.join(','),
  ].join('|');

  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const url = new URL(`${DEALS_API_URL}/feed`);
  url.searchParams.set('category', normalizedCategory);
  if (cursor) url.searchParams.set('cursor', cursor);

  for (const retailer of normalizedRetailers) {
    url.searchParams.append('retailer', retailer);
  }

  const payload = await requestJson(url);
  const result = {
    type: 'feed',
    category: payload.category || normalizedCategory,
    categoryLabel: payload.categoryLabel || categoryLabel(normalizedCategory),
    retailers: Array.isArray(payload.retailers)
      ? payload.retailers
      : normalizedRetailers,
    count: Number.isFinite(payload.count)
      ? payload.count
      : Array.isArray(payload.items)
        ? payload.items.length
        : 0,
    items: Array.isArray(payload.items) ? payload.items : [],
    cursor: payload.cursor || '',
    nextCursor: payload.nextCursor || '',
    hasMore: Boolean(payload.hasMore),
    mode: payload.mode || 'category',
    attempts: Array.isArray(payload.attempts) ? payload.attempts : [],
    retrievedAt: payload.retrievedAt || new Date().toISOString(),
  };

  writeCache(cacheKey, result);
  return result;
}

export async function searchDeals(
  query,
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const cleanQuery = String(query || '').trim();

  if (!cleanQuery) {
    return {
      query: '',
      retailers: normalizeRetailers(retailers),
      count: 0,
      items: [],
      retrievedAt: new Date().toISOString(),
    };
  }

  const normalizedRetailers = normalizeRetailers(retailers);
  const cacheKey = [
    CACHE_PREFIX,
    'search',
    cleanQuery.toLowerCase(),
    normalizedRetailers.join(','),
  ].join('|');

  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const url = new URL(`${DEALS_API_URL}/search`);
  url.searchParams.set('q', cleanQuery);

  for (const retailer of normalizedRetailers) {
    url.searchParams.append('retailer', retailer);
  }

  const payload = await requestJson(url);
  const result = {
    query: payload.query || cleanQuery,
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
    retrievedAt: payload.retrievedAt || new Date().toISOString(),
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
      .map((item) => (
        typeof item === 'string'
          ? item
          : item.key || item.name || item.product || item.label || ''
      ))
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )].slice(0, 30);

  const normalizedRetailers = normalizeRetailers(retailers);

  if (!queries.length) {
    return {
      retailers: normalizedRetailers,
      retrievedAt: new Date().toISOString(),
      results: [],
    };
  }

  const results = [];

  for (const query of queries) {
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
        error: getErrorMessage(error),
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
    const keys = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }

    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Live requests still work when browser storage is unavailable.
  }
}

async function requestJson(url) {
  let response;

  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (error) {
    throw new Error(
      `De live aanbiedingenservice kon niet worden bereikt. ${getErrorMessage(error)}`
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
  const result = [...new Set(
    values
      .map((value) => String(value || '').trim())
      .filter((retailer) => allowed.has(retailer))
  )];

  return result.length ? result : [...DEFAULT_RETAILERS];
}

function normalizeCategorySlug(value) {
  const slug = String(value || 'all').trim().toLowerCase();
  return DEAL_CATEGORIES.some((category) => category.slug === slug)
    ? slug
    : 'all';
}

function categoryLabel(slug) {
  return DEAL_CATEGORIES.find((category) => category.slug === slug)?.label || 'Alle categorieën';
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
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      value,
    }));
  } catch {
    // Ignore storage limits and private-mode restrictions.
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
