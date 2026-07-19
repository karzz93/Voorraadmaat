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

export async function loadTopDeals(
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const normalizedRetailers =
    normalizeRetailers(retailers);

  const cacheKey =
    `${CACHE_PREFIX}top|` +
    normalizedRetailers.join(',');

  if (!force) {
    const cached = readCache(cacheKey);

    if (cached) {
      return cached;
    }
  }

  const url = new URL(
    `${DEALS_API_URL}/top`
  );

  for (const retailer of normalizedRetailers) {
    url.searchParams.append(
      'retailer',
      retailer
    );
  }

  const payload = await requestJson(url);

  const result = {
    type: 'top',

    retailers:
      Array.isArray(payload.retailers)
        ? payload.retailers
        : normalizedRetailers,

    count:
      Number.isFinite(payload.count)
        ? payload.count
        : Array.isArray(payload.items)
          ? payload.items.length
          : 0,

    items:
      Array.isArray(payload.items)
        ? payload.items
        : [],

    retrievedAt:
      payload.retrievedAt ||
      new Date().toISOString(),
  };

  writeCache(
    cacheKey,
    result
  );

  return result;
}

export async function searchDeals(
  query,
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const cleanQuery =
    String(query || '').trim();

  if (!cleanQuery) {
    return {
      query: '',
      retailers:
        normalizeRetailers(retailers),
      count: 0,
      items: [],
      retrievedAt:
        new Date().toISOString(),
    };
  }

  const normalizedRetailers =
    normalizeRetailers(retailers);

  const cacheKey =
    `${CACHE_PREFIX}search|` +
    `${cleanQuery.toLowerCase()}|` +
    normalizedRetailers.join(',');

  if (!force) {
    const cached = readCache(cacheKey);

    if (cached) {
      return cached;
    }
  }

  const url = new URL(
    `${DEALS_API_URL}/search`
  );

  url.searchParams.set(
    'q',
    cleanQuery
  );

  for (const retailer of normalizedRetailers) {
    url.searchParams.append(
      'retailer',
      retailer
    );
  }

  const payload = await requestJson(url);

  const result = {
    query:
      payload.query ||
      cleanQuery,

    retailers:
      Array.isArray(payload.retailers)
        ? payload.retailers
        : normalizedRetailers,

    count:
      Number.isFinite(payload.count)
        ? payload.count
        : Array.isArray(payload.items)
          ? payload.items.length
          : 0,

    items:
      Array.isArray(payload.items)
        ? payload.items
        : [],

    attempts:
      Array.isArray(payload.attempts)
        ? payload.attempts
        : [],

    retrievedAt:
      payload.retrievedAt ||
      new Date().toISOString(),
  };

  writeCache(
    cacheKey,
    result
  );

  return result;
}

export async function searchShoppingListDeals(
  shoppingItems,
  retailers = DEFAULT_RETAILERS,
  { force = false } = {}
) {
  const normalizedRetailers =
    normalizeRetailers(retailers);

  const queries = [
    ...new Set(
      shoppingItems
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }

          return (
            item.key ||
            item.name ||
            item.product ||
            item.label ||
            ''
          );
        })
        .map((value) =>
          String(value || '').trim()
        )
        .filter(Boolean)
    ),
  ].slice(0, 30);

  if (!queries.length) {
    return {
      retailers:
        normalizedRetailers,

      retrievedAt:
        new Date().toISOString(),

      results: [],
    };
  }

  const results = [];

  /*
   * Search each shopping-list item separately.
   * This allows caching per item and prevents one
   * failed search from breaking the complete list.
   */
  for (const query of queries) {
    try {
      const response =
        await searchDeals(
          query,
          normalizedRetailers,
          { force }
        );

      results.push({
        query,
        count:
          response.items.length,
        items:
          response.items,
      });
    } catch (error) {
      console.warn(
        `Deal search failed for "${query}"`,
        error
      );

      results.push({
        query,
        count: 0,
        items: [],
        error:
          getErrorMessage(error),
      });
    }
  }

  return {
    retailers:
      normalizedRetailers,

    retrievedAt:
      new Date().toISOString(),

    results,
  };
}

export function clearDealsCache() {
  try {
    const keys = [];

    for (
      let index = 0;
      index < localStorage.length;
      index += 1
    ) {
      const key =
        localStorage.key(index);

      if (
        key &&
        key.startsWith(
          CACHE_PREFIX
        )
      ) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /*
     * Local storage is optional.
     * Live search still works without it.
     */
  }
}

async function requestJson(url) {
  let response;

  try {
    response = await fetch(
      url.toString(),
      {
        method: 'GET',

        headers: {
          Accept:
            'application/json',
        },

        cache: 'no-store',
      }
    );
  } catch (error) {
    throw new Error(
      'De live aanbiedingenservice kon niet worden bereikt. ' +
      getErrorMessage(error)
    );
  }

  let payload;

  try {
    payload =
      await response.json();
  } catch {
    throw new Error(
      'De aanbiedingenservice gaf geen geldige JSON terug.'
    );
  }

  if (!response.ok) {
    throw new Error(
      payload?.details ||
      payload?.error ||
      `De aanbiedingenservice gaf status ${response.status}.`
    );
  }

  return payload;
}

function normalizeRetailers(
  retailers
) {
  const allowed =
    new Set(
      DEFAULT_RETAILERS
    );

  const values =
    Array.isArray(retailers)
      ? retailers
      : DEFAULT_RETAILERS;

  const normalized = [
    ...new Set(
      values
        .map((value) =>
          String(value || '').trim()
        )
        .filter((retailer) =>
          allowed.has(retailer)
        )
    ),
  ];

  return normalized.length
    ? normalized
    : [...DEFAULT_RETAILERS];
}

function readCache(key) {
  try {
    const raw =
      localStorage.getItem(key);

    if (!raw) {
      return null;
    }

    const cached =
      JSON.parse(raw);

    if (
      !cached ||
      typeof cached !== 'object' ||
      !cached.savedAt ||
      !cached.value
    ) {
      localStorage.removeItem(key);
      return null;
    }

    if (
      Date.now() -
      cached.savedAt >
      CACHE_TTL_MS
    ) {
      localStorage.removeItem(key);
      return null;
    }

    return cached.value;
  } catch {
    return null;
  }
}

function writeCache(
  key,
  value
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt:
          Date.now(),

        value,
      })
    );
  } catch {
    /*
     * Ignore private-mode restrictions
     * and local-storage limits.
     */
  }
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}
