#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_PATH = path.resolve(__dirname, '../site/data/deals.json');
const INDEX_PATH = path.resolve(__dirname, '../site/data/deal-index.json');

const SEARCH_ENDPOINT =
  process.env.DEALS_API_URL ||
  'https://www.prijsprofeet.nl/api/v1/search';

const RETAILERS = [
  'albert_heijn',
  'dirk',
  'lidl',
  'hoogvliet',
  'plus',
];

const API_KEY = process.env.PRIJS_PROFEET_API_KEY || '';
const PAGE_SIZE = positiveInteger(process.env.DEALS_PAGE_SIZE, 100);
const MAX_PAGES = positiveInteger(process.env.DEALS_MAX_PAGES, 150);
const REQUEST_DELAY_MS = positiveInteger(
  process.env.DEALS_REQUEST_DELAY_MS,
  550
);

const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/your-name/voorraadmaat';

const USER_AGENT = `Voorraadmaat/3.0 (+${repository})`;

main().catch(async (error) => {
  console.error(`Deals refresh failed: ${error.stack || error}`);

  if (process.env.STRICT_DEALS === '1') {
    process.exitCode = 1;
    return;
  }

  await preserveExisting(`Refresh failed: ${error.message || error}`);
});

async function main() {
  console.log('Refreshing complete supermarket deal database.');
  console.log(`Endpoint: ${SEARCH_ENDPOINT}`);
  console.log(`Retailers: ${RETAILERS.join(', ')}`);
  console.log(`API key configured: ${API_KEY ? 'yes' : 'no'}`);

  const allDeals = [];
  const retailerStats = {};

  for (const retailer of RETAILERS) {
    const result = await fetchAllDealsForRetailer(retailer);

    retailerStats[retailer] = {
      rawItems: result.rawItems,
      usableDeals: result.deals.length,
      requests: result.requests,
      paginationMode: result.paginationMode,
    };

    allDeals.push(...result.deals);
  }

  const deals = deduplicate(allDeals)
    .filter(isUsableDeal)
    .sort(sortDeals);

  if (!deals.length) {
    throw new Error(
      'The API returned no usable deals; existing data was kept.'
    );
  }

  const coveredRetailers = [
    ...new Set(deals.map((deal) => deal.retailer)),
  ];

  const missingRetailers = RETAILERS.filter(
    (retailer) => !coveredRetailers.includes(retailer)
  );

  const categoryCounts = countBy(deals, (deal) => deal.category || 'Overig');
  const retailerCounts = countBy(deals, (deal) => deal.retailer);

  const output = {
    meta: {
      status: 'live',
      generatedAt: new Date().toISOString(),
      source: 'PrijsProfeet search API',
      sourceUrl: 'https://www.prijsprofeet.nl',
      endpoint: SEARCH_ENDPOINT,
      retailers: RETAILERS,
      coveredRetailers,
      missingRetailers,
      count: deals.length,
      retailerStats,
      retailerCounts,
      categoryCounts,
      attributionRequired: true,
      note: 'Prices are indicative; verify with the retailer.',
    },
    deals,
  };

  const index = buildDealIndex(deals);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  await Promise.all([
    writeFile(
      OUTPUT_PATH,
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      INDEX_PATH,
      `${JSON.stringify(index)}\n`,
      'utf8'
    ),
  ]);

  console.log(`Wrote ${deals.length} deals to ${OUTPUT_PATH}.`);
  console.log(
    `Wrote compact matching index with ${index.entries.length} entries to ${INDEX_PATH}.`
  );
}

async function fetchAllDealsForRetailer(retailer) {
  let mode = 'page';
  let page = 1;
  let offset = 0;
  let cursor = null;
  let requests = 0;
  let rawItems = 0;

  const deals = [];
  const seenFingerprints = new Set();

  while (requests < MAX_PAGES) {
    const url = buildSearchUrl({
      retailer,
      mode,
      page,
      offset,
      cursor,
    });

    console.log(
      `${retailer}: request ${requests + 1} (${mode}, page ${page}, offset ${offset})`
    );

    const payload = await fetchJson(url);
    requests += 1;

    const items = extractSearchItems(payload);
    const fingerprint = createPageFingerprint(items);

    if (items.length && seenFingerprints.has(fingerprint)) {
      if (mode === 'page' && requests === 2) {
        console.warn(
          `${retailer}: page pagination appears ignored; switching to offset.`
        );

        mode = 'offset';
        offset = PAGE_SIZE;
        cursor = null;
        continue;
      }

      console.warn(
        `${retailer}: repeated page detected; stopping safely.`
      );
      break;
    }

    if (items.length) {
      seenFingerprints.add(fingerprint);
    }

    rawItems += items.length;

    const normalized = items
      .map((raw) =>
        normalizeDeal({
          ...raw,
          retailer:
            raw?.retailer ||
            raw?.retailer_slug ||
            raw?.retailerSlug ||
            retailer,
        })
      )
      .filter(Boolean);

    deals.push(...normalized);

    console.log(
      `${retailer}: ${items.length} raw, ${normalized.length} usable.`
    );

    const next = determineNextPage({
      payload,
      returnedCount: items.length,
      page,
      offset,
      cursor,
      mode,
    });

    if (!next.hasMore) {
      break;
    }

    mode = next.mode;
    page = next.page;
    offset = next.offset;
    cursor = next.cursor;

    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  if (requests >= MAX_PAGES) {
    throw new Error(
      `Pagination safety limit reached for ${retailer}.`
    );
  }

  console.log(
    `${retailer}: finished with ${deals.length} usable deals.`
  );

  return {
    deals,
    rawItems,
    requests,
    paginationMode: mode,
  };
}

function buildSearchUrl({ retailer, mode, page, offset, cursor }) {
  const url = new URL(SEARCH_ENDPOINT);

  url.searchParams.set('retailer', retailer);
  url.searchParams.set('promotion_status', 'active');
  url.searchParams.set('status', 'active');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('per_page', String(PAGE_SIZE));

  if (mode === 'cursor' && cursor) {
    url.searchParams.set('cursor', cursor);
  } else if (mode === 'offset') {
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('skip', String(offset));
  } else {
    url.searchParams.set('page', String(page));
  }

  return url;
}

async function fetchJson(url) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };

  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(45_000),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}` +
      (body ? `: ${body.slice(0, 600)}` : '')
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `The API did not return JSON. Response started with: ${body.slice(0, 400)}`
    );
  }
}

function extractSearchItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.results,
    payload.items,
    payload.products,
    payload.deals,
    payload.offers,
    payload.data,
    payload.data?.results,
    payload.data?.items,
    payload.data?.products,
    payload.data?.deals,
    payload.response?.results,
    payload.response?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  for (const value of Object.values(payload)) {
    if (
      Array.isArray(value) &&
      value.some((item) => item && typeof item === 'object') &&
      value.some(looksLikeProduct)
    ) {
      return value;
    }
  }

  return [];
}

function determineNextPage({
  payload,
  returnedCount,
  page,
  offset,
  cursor,
  mode,
}) {
  const pagination =
    payload?.pagination ||
    payload?.meta?.pagination ||
    payload?.meta ||
    payload?.page_info ||
    payload?.pageInfo ||
    {};

  const nextCursor = firstString(
    pagination.next_cursor,
    pagination.nextCursor,
    payload?.next_cursor,
    payload?.nextCursor
  );

  if (nextCursor && nextCursor !== cursor) {
    return {
      hasMore: true,
      mode: 'cursor',
      page,
      offset,
      cursor: nextCursor,
    };
  }

  const totalPages = numberOrNull(
    pagination.total_pages ??
      pagination.totalPages ??
      payload?.total_pages ??
      payload?.totalPages
  );

  if (totalPages != null && totalPages > 0) {
    return {
      hasMore: page < totalPages,
      mode: 'page',
      page: page + 1,
      offset: offset + PAGE_SIZE,
      cursor: null,
    };
  }

  const total = numberOrNull(
    pagination.total ??
      pagination.total_count ??
      pagination.totalCount ??
      payload?.total ??
      payload?.total_count ??
      payload?.totalCount
  );

  if (total != null && total >= 0) {
    const consumed =
      mode === 'offset'
        ? offset + returnedCount
        : page * PAGE_SIZE;

    return {
      hasMore: consumed < total,
      mode,
      page: page + 1,
      offset: offset + PAGE_SIZE,
      cursor: null,
    };
  }

  const hasNext =
    pagination.has_next ??
    pagination.hasNext ??
    payload?.has_next ??
    payload?.hasNext;

  if (typeof hasNext === 'boolean') {
    return {
      hasMore: hasNext,
      mode,
      page: page + 1,
      offset: offset + PAGE_SIZE,
      cursor: null,
    };
  }

  return {
    hasMore: returnedCount >= PAGE_SIZE,
    mode,
    page: page + 1,
    offset: offset + PAGE_SIZE,
    cursor: null,
  };
}

function looksLikeProduct(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const product =
    value.representative_product ||
    value.representativeProduct ||
    value.product ||
    value;

  return Boolean(
    product.name ||
    product.title ||
    product.product_name ||
    product.productName
  );
}

function normalizeDeal(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const representativeProduct =
    raw.representative_product ||
    raw.representativeProduct ||
    null;

  const item = representativeProduct
    ? {
        ...raw,
        ...representativeProduct,
        retailer:
          representativeProduct.retailer ||
          raw.retailer,
        savings_percentage:
          representativeProduct.savings_percentage ??
          raw.savings_percentage,
        savings_amount:
          representativeProduct.savings_amount ??
          raw.savings_amount,
        promotion_type:
          representativeProduct.promotion_type ||
          raw.promotion_type,
        brand:
          representativeProduct.brand ||
          raw.brand,
      }
    : raw;

  const retailer = normalizeRetailer(
    item.retailer?.slug ||
      item.retailer?.name ||
      item.retailer ||
      item.retailer_slug ||
      item.retailerSlug ||
      item.store?.slug ||
      item.store?.name ||
      item.store ||
      item.store_name ||
      item.storeName ||
      item.supermarket?.slug ||
      item.supermarket?.name ||
      item.supermarket
  );

  const name = firstString(
    item.name,
    item.title,
    item.product_name,
    item.productName,
    item.display_name,
    item.displayName,
    item.description,
    item.product?.name,
    item.product?.title
  );

  const price = numberOrNull(
    item.price ??
      item.deal_price ??
      item.dealPrice ??
      item.current_price ??
      item.currentPrice ??
      item.offer_price ??
      item.offerPrice ??
      item.sale_price ??
      item.salePrice ??
      item.discount_price ??
      item.discountPrice ??
      item.product?.price
  );

  if (
    !retailer ||
    !RETAILERS.includes(retailer) ||
    !name ||
    price == null
  ) {
    return null;
  }

  const originalPrice = numberOrNull(
    item.original_price ??
      item.originalPrice ??
      item.regular_price ??
      item.regularPrice ??
      item.normal_price ??
      item.normalPrice ??
      item.list_price ??
      item.listPrice ??
      item.was_price ??
      item.wasPrice ??
      item.product?.original_price ??
      item.product?.originalPrice
  );

  let discountPercentage = numberOrNull(
    item.savings_percentage ??
      item.savingsPercentage ??
      item.discount_percentage ??
      item.discountPercentage ??
      item.discount_percent ??
      item.discountPercent ??
      item.discount
  );

  if (
    discountPercentage == null &&
    originalPrice != null &&
    originalPrice > 0 &&
    price < originalPrice
  ) {
    discountPercentage = round2(
      ((originalPrice - price) / originalPrice) * 100
    );
  }

  const rawCategory = firstString(
    item.category?.name,
    item.category,
    item.category_name,
    item.categoryName,
    item.product?.category?.name,
    item.product?.category
  );

  const category = normalizeCategory(rawCategory, name);

  const searchableText = [
    name,
    item.brand,
    item.quantity,
    category,
    item.promotion_type,
    item.offer_text,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: String(
      item.id ||
        item.deal_id ||
        item.dealId ||
        item.product_id ||
        item.productId ||
        item.ean ||
        item.product?.id ||
        `${retailer}-${slugify(name)}-${price}`
    ),
    retailer,
    name,
    brand: firstString(item.brand, item.product?.brand),
    price,
    originalPrice,
    discountPercentage,
    savingsAmount: numberOrNull(
      item.savings_amount ??
        item.savingsAmount
    ),
    unitPrice: firstString(
      item.unit_price,
      item.unitPrice,
      item.price_per_unit,
      item.pricePerUnit,
      item.product?.unit_price,
      item.product?.unitPrice
    ),
    quantity: firstString(
      item.quantity,
      item.package_size,
      item.packageSize,
      item.size,
      item.content,
      item.product?.quantity
    ),
    category,
    promotionType: firstString(
      item.promotion_type,
      item.promotionType,
      item.offer_text,
      item.offerText,
      item.deal_text,
      item.dealText,
      item.promotion?.type,
      item.promotion?.text
    ),
    promotionStatus: firstString(
      item.promotion_status,
      item.promotionStatus,
      item.status,
      item.promotion?.status
    ),
    validFrom: firstString(
      item.valid_from,
      item.validFrom,
      item.start_date,
      item.startDate,
      item.starts_at,
      item.startsAt,
      item.promotion?.valid_from
    ),
    validUntil: firstString(
      item.valid_until,
      item.validUntil,
      item.end_date,
      item.endDate,
      item.ends_at,
      item.endsAt,
      item.promotion?.valid_until
    ),
    ean: firstString(
      item.ean,
      item.ean_code,
      item.eanCode,
      item.barcode,
      item.product?.ean
    ),
    url: firstString(
      item.url,
      item.product_url,
      item.productUrl,
      item.deal_url,
      item.dealUrl,
      item.product?.url
    ),
    imageUrl: firstString(
      item.image_url,
      item.imageUrl,
      item.image,
      item.thumbnail,
      item.thumbnail_url,
      item.thumbnailUrl,
      item.product?.image_url,
      item.product?.imageUrl
    ),
    searchTokens: tokenize(searchableText),
  };
}

function buildDealIndex(deals) {
  const entries = deals.map((deal, index) => ({
    i: index,
    r: deal.retailer,
    n: deal.name,
    b: deal.brand || '',
    c: deal.category || 'Overig',
    p: deal.price,
    o: deal.originalPrice,
    d: deal.discountPercentage,
    q: deal.quantity || '',
    e: deal.ean || '',
    t: deal.searchTokens,
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    retailers: RETAILERS,
    entries,
  };
}

function normalizeCategory(rawCategory, productName) {
  const text = normalizeText(`${rawCategory || ''} ${productName || ''}`);

  const rules = [
    ['Groente & Fruit', ['groente', 'fruit', 'appel', 'banaan', 'tomaat', 'aardappel', 'salade']],
    ['Zuivel & Eieren', ['zuivel', 'melk', 'yoghurt', 'kwark', 'ei', 'eieren', 'boter']],
    ['Vlees & Gevogelte', ['vlees', 'kip', 'gehakt', 'worst', 'burger', 'biefstuk']],
    ['Vis & Zeevruchten', ['vis', 'zalm', 'tonijn', 'garnaal', 'zeeproduct']],
    ['Kaas & Vleeswaren', ['kaas', 'vleeswaren', 'ham', 'salami']],
    ['Brood & Bakkerij', ['brood', 'bol', 'croissant', 'bakkerij', 'wrap']],
    ['Ontbijt & Beleg', ['ontbijt', 'muesli', 'cornflakes', 'hagelslag', 'jam', 'pindakaas']],
    ['Pasta, Rijst & Wereldkeuken', ['pasta', 'rijst', 'noedel', 'couscous', 'tortilla']],
    ['Soepen, Conserven & Sauzen', ['soep', 'saus', 'conserven', 'blik', 'tomatenblokjes']],
    ['Snoep, Koek & Chips', ['snoep', 'koek', 'chips', 'chocolade', 'drop']],
    ['Frisdrank & Sappen', ['frisdrank', 'sap', 'cola', 'limonade', 'water']],
    ['Koffie & Thee', ['koffie', 'thee', 'capsule']],
    ['Bier, Wijn & Dranken', ['bier', 'wijn', 'drank', 'alcohol']],
    ['Diepvries', ['diepvries', 'bevroren', 'ijs']],
    ['Vega & Plantaardig', ['vega', 'vegan', 'plantaardig', 'tofu']],
    ['Huishouden & Dier', ['wasmiddel', 'toiletpapier', 'schoonmaak', 'kat', 'hond', 'dier']],
    ['Drogisterij & Baby', ['shampoo', 'tandpasta', 'deodorant', 'luier', 'baby', 'drogisterij']],
  ];

  for (const [category, words] of rules) {
    if (words.some((word) => text.includes(word))) {
      return category;
    }
  }

  return rawCategory || 'Overig';
}

function normalizeRetailer(value = '') {
  const normalized = normalizeText(value).replace(/\s+/g, '_');

  if (
    normalized === 'ah' ||
    (normalized.includes('albert') &&
      normalized.includes('heijn'))
  ) {
    return 'albert_heijn';
  }

  if (normalized.includes('hoogvliet')) return 'hoogvliet';
  if (normalized.includes('dirk')) return 'dirk';
  if (normalized.includes('lidl')) return 'lidl';

  if (
    normalized === 'plus' ||
    normalized.startsWith('plus_') ||
    normalized.endsWith('_plus')
  ) {
    return 'plus';
  }

  return normalized;
}

function tokenize(value) {
  return [...new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  )];
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isUsableDeal(deal) {
  return (
    deal &&
    RETAILERS.includes(deal.retailer) &&
    deal.name &&
    Number.isFinite(deal.price)
  );
}

function sortDeals(a, b) {
  return (
    a.retailer.localeCompare(b.retailer) ||
    (b.discountPercentage || 0) -
      (a.discountPercentage || 0) ||
    a.name.localeCompare(b.name, 'nl')
  );
}

function firstString(...values) {
  for (const value of values) {
    if (value == null) continue;

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  if (!normalized) return null;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function slugify(value) {
  return normalizeText(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function deduplicate(items) {
  const map = new Map();

  for (const item of items) {
    const key = [
      item.retailer,
      item.ean || '',
      slugify(item.name),
      item.price,
      item.validUntil || '',
    ].join('|');

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

function countBy(items, selector) {
  return Object.fromEntries(
    [...items.reduce((map, item) => {
      const key = selector(item);
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map()).entries()].sort((a, b) => b[1] - a[1])
  );
}

function createPageFingerprint(items) {
  return items.slice(0, 8).map((item) => {
    const product =
      item?.representative_product ||
      item?.representativeProduct ||
      item?.product ||
      item ||
      {};

    return [
      product.id ||
        product.product_id ||
        product.productId ||
        product.ean ||
        '',
      product.name ||
        product.title ||
        product.product_name ||
        '',
      product.price ||
        product.offer_price ||
        product.current_price ||
        '',
    ].join(':');
  }).join('|');
}

function sleep(milliseconds) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}

async function preserveExisting(reason) {
  try {
    const existing = JSON.parse(
      await readFile(OUTPUT_PATH, 'utf8')
    );

    existing.meta ||= {};
    existing.meta.lastRefreshError = reason;
    existing.meta.lastRefreshAttempt =
      new Date().toISOString();

    await writeFile(
      OUTPUT_PATH,
      `${JSON.stringify(existing, null, 2)}\n`,
      'utf8'
    );

    console.warn(
      `${reason} Existing deals file was preserved.`
    );
  } catch (error) {
    console.warn(
      `${reason} Existing file could not be updated: ${error.message}`
    );
  }
}
