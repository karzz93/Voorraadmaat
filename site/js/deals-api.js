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

  if (!cleanQuery) {
    return {
      query: '',
      retailers,
      count: 0,
      items: [],
    };
  }

  const normalizedRetailers = [
    ...new Set(
      retailers.filter(Boolean)
    ),
  ];

  const cacheKey = createCacheKey(
    cleanQuery,
    normalizedRetailers
  );

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

  for (
    const retailer
    of normalizedRetailers
  ) {
    url.searchParams.append(
      'retailer',
      retailer
    );
  }

  let response;

  try {
    response = await fetch(
      url.toString(),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );
  } catch (error) {
    throw new Error(
      `De aanbiedingenservice kon niet worden bereikt: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  let payload;

  try {
    payload = await response.json();
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
  const queries = [
    ...new Set(
      shoppingItems
        .map((item) =>
          typeof item === 'string'
            ? item
            : item.name ||
              item.product ||
              item.label ||
              ''
        )
        .map((value) =>
          String(value).trim()
        )
        .filter(Boolean)
    ),
  ];

  if (!queries.length) {
    return {
      retailers,
      retrievedAt:
        new Date().toISOString(),
      results: [],
    };
  }

  /*
   * Use individual searches rather than /batch.
   * This reuses the browser cache and gives one product
   * failure without failing the complete shopping list.
   */
  const settled =
    await Promise.allSettled(
      queries.map((query) =>
        searchDeals(
          query,
          retailers,
          { force }
        )
      )
    );

  const results =
    settled.map(
      (result, index) => {
        if (
          result.status ===
          'fulfilled'
        ) {
          return {
            query:
              queries[index],
            count:
              result.value.count,
            items:
              result.value.items,
          };
        }

        return {
          query:
            queries[index],
          count: 0,
          items: [],
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(
                  result.reason
                ),
        };
      }
    );

  return {
    retailers,
    retrievedAt:
      new Date().toISOString(),
    results,
  };
}

export function clearDealsCache() {
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
}

function createCacheKey(
  query,
  retailers
) {
  return (
    CACHE_PREFIX +
    JSON.stringify({
      query:
        query.toLowerCase(),
      retailers:
        [...retailers].sort(),
    })
  );
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
      !cached.savedAt ||
      !cached.value
    ) {
      localStorage.removeItem(
        key
      );

      return null;
    }

    if (
      Date.now() -
      cached.savedAt >
      CACHE_TTL_MS
    ) {
      localStorage.removeItem(
        key
      );

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
    // The app still works when localStorage is full or unavailable.
  }
}
