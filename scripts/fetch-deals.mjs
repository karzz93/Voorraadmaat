#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const outputPath = path.resolve(
  __dirname,
  '../site/data/deals.json'
);

const endpoint =
  process.env.DEALS_API_URL ||
  'https://www.prijsprofeet.nl/api/v1/deals/top';

const retailers = [
  'albert_heijn',
  'dirk',
  'lidl',
  'hoogvliet',
  'plus',
];

const apiKey = process.env.PRIJS_PROFEET_API_KEY || '';

const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/your-name/voorraadmaat';

const userAgent = `Voorraadmaat/1.2 (+${repository})`;

main().catch(async (error) => {
  console.error(`Deals refresh failed: ${error.stack || error}`);

  if (process.env.STRICT_DEALS === '1') {
    process.exitCode = 1;
    return;
  }

  await preserveExisting(
    `Refresh failed: ${error.message || error}`
  );
});

async function main() {
  console.log('Starting supermarket deal refresh.');
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Retailers: ${retailers.join(', ')}`);
  console.log(`API key configured: ${apiKey ? 'yes' : 'no'}`);

  const combinedUrl = new URL(endpoint);

  for (const retailer of retailers) {
    combinedUrl.searchParams.append('retailer', retailer);
  }

  let deals = [];

  try {
    const payload = await fetchJson(combinedUrl);
    const extracted = extractDeals(payload);

    console.log(
      `Combined response contained ${extracted.length} candidate item(s).`
    );

    deals.push(
      ...extracted
        .map(normalizeDeal)
        .filter(Boolean)
    );
  } catch (error) {
    console.warn(`Combined request failed: ${error.message}`);
  }

  let coveredRetailers = new Set(
    deals.map((deal) => deal.retailer)
  );

  let missingRetailers = retailers.filter(
    (retailer) => !coveredRetailers.has(retailer)
  );

  if (!deals.length || missingRetailers.length) {
    const retailersToFetch = deals.length
      ? missingRetailers
      : retailers;

    console.log(
      `Trying separate requests for: ${retailersToFetch.join(', ')}`
    );

    const results = await Promise.allSettled(
      retailersToFetch.map(async (retailer) => {
        const url = new URL(endpoint);
        url.searchParams.set('retailer', retailer);

        const payload = await fetchJson(url);

        const extracted = extractDeals(
          payload,
          0,
          retailer
        );

        console.log(
          `${retailer}: extracted ${extracted.length} candidate item(s).`
        );

        return extracted
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
      })
    );

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const retailer = retailersToFetch[index];

      if (result.status === 'fulfilled') {
        console.log(
          `${retailer}: normalized ${result.value.length} deal(s).`
        );

        deals.push(...result.value);
      } else {
        console.warn(
          `${retailer} request failed: ${
            result.reason?.message || result.reason
          }`
        );
      }
    }
  }

  deals = deduplicate(deals)
    .filter(
      (deal) =>
        retailers.includes(deal.retailer) &&
        deal.name &&
        deal.price != null
    )
    .sort(
      (a, b) =>
        a.retailer.localeCompare(b.retailer) ||
        (b.discountPercentage || 0) -
          (a.discountPercentage || 0) ||
        a.name.localeCompare(b.name, 'nl')
    );

  coveredRetailers = new Set(
    deals.map((deal) => deal.retailer)
  );

  missingRetailers = retailers.filter(
    (retailer) => !coveredRetailers.has(retailer)
  );

  console.log(`Final usable deal count: ${deals.length}`);

  console.log(
    `Retailers found: ${
      [...coveredRetailers].join(', ') || 'none'
    }`
  );

  if (missingRetailers.length) {
    console.warn(
      `No usable deals found for: ${missingRetailers.join(', ')}`
    );
  }

  if (!deals.length) {
    throw new Error(
      'The API returned no usable deals; existing data was kept.'
    );
  }

  const output = {
    meta: {
      status: 'live',
      generatedAt: new Date().toISOString(),
      source: 'PrijsProfeet public deals API',
      sourceUrl: 'https://www.prijsprofeet.nl',
      endpoint,
      retailers,
      coveredRetailers: [...coveredRetailers],
      missingRetailers,
      count: deals.length,
      attributionRequired: true,
    },
    deals,
  };

  await writeFile(
    outputPath,
    `${JSON.stringify(output, null, 2)}\n`,
    'utf8'
  );

  console.log(
    `Wrote ${deals.length} deal(s) to ${outputPath}.`
  );
}

async function fetchJson(url) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': userAgent,
  };

  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  console.log(`Requesting: ${url}`);

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}` +
        (
          responseText
            ? `: ${responseText.slice(0, 500)}`
            : ''
        )
    );
  }

  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      `The API did not return valid JSON. Response started with: ${responseText.slice(0, 300)}`
    );
  }

  console.log(
    `Response structure: ${describePayload(payload)}`
  );

  console.log(
    `Response sample: ${JSON.stringify(payload).slice(0, 1500)}`
  );

  return payload;
}

function describePayload(payload) {
  if (Array.isArray(payload)) {
    return `array with ${payload.length} item(s)`;
  }

  if (payload && typeof payload === 'object') {
    const keys = Object.keys(payload);

    return `object with keys: ${
      keys.join(', ') || '(none)'
    }`;
  }

  return typeof payload;
}

function extractDeals(
  payload,
  depth = 0,
  inheritedRetailer = null
) {
  if (depth > 8 || payload == null) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      return [{
        ...item,
        retailer:
          item.retailer ||
          item.retailer_slug ||
          item.retailerSlug ||
          inheritedRetailer,
      }];
    });
  }

  if (typeof payload !== 'object') {
    return [];
  }

  if (looksLikeDeal(payload)) {
    return [{
      ...payload,
      retailer:
        payload.retailer ||
        payload.retailer_slug ||
        payload.retailerSlug ||
        inheritedRetailer,
    }];
  }

  const directRetailer =
    payload.retailer?.slug ||
    payload.retailer?.name ||
    payload.retailer ||
    payload.retailer_slug ||
    payload.retailerSlug ||
    payload.store?.slug ||
    payload.store?.name ||
    payload.store ||
    payload.supermarket?.slug ||
    payload.supermarket?.name ||
    payload.supermarket ||
    inheritedRetailer;

  const preferredKeys = [
    'top_by_percentage',
    'top_by_amount',
    'deals',
    'items',
    'results',
    'products',
    'offers',
    'promotions',
    'data',
    'top_deals',
    'topDeals',
    'content',
    'records',
    'entries',
  ];

  const collected = [];

  for (const key of preferredKeys) {
    if (payload[key] == null) {
      continue;
    }

    collected.push(
      ...extractDeals(
        payload[key],
        depth + 1,
        directRetailer
      )
    );
  }

  if (collected.length) {
    return collected;
  }

  for (const [key, value] of Object.entries(payload)) {
    const retailerFromKey = normalizeRetailer(key);

    const nextRetailer =
      retailers.includes(retailerFromKey)
        ? retailerFromKey
        : directRetailer;

    collected.push(
      ...extractDeals(
        value,
        depth + 1,
        nextRetailer
      )
    );
  }

  return collected;
}

function looksLikeDeal(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  if (
    value.representative_product ||
    value.representativeProduct
  ) {
    return true;
  }

  const hasName = Boolean(
    value.name ||
    value.title ||
    value.product_name ||
    value.productName ||
    value.description ||
    value.product?.name
  );

  const hasPrice = [
    value.price,
    value.current_price,
    value.currentPrice,
    value.offer_price,
    value.offerPrice,
    value.product?.price,
  ].some(
    (candidate) =>
      candidate !== undefined &&
      candidate !== null &&
      candidate !== ''
  );

  return hasName && hasPrice;
}

function normalizeDeal(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

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

  const retailerValue =
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
    item.supermarket;

  const retailer = normalizeRetailer(retailerValue);

  const name = firstString(
    item.name,
    item.title,
    item.product_name,
    item.productName,
    item.display_name,
    item.displayName,
    item.description,
    item.product?.name,
    item.product?.title,
    item.product?.description
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
    !retailers.includes(retailer) ||
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
    discountPercentage = Math.round(
      ((originalPrice - price) / originalPrice) * 100
    );
  }

  const validFrom = firstString(
    item.valid_from,
    item.validFrom,
    item.start_date,
    item.startDate,
    item.starts_at,
    item.startsAt,
    item.promotion?.valid_from,
    item.promotion?.validFrom
  );

  const validUntil = firstString(
    item.valid_until,
    item.validUntil,
    item.end_date,
    item.endDate,
    item.ends_at,
    item.endsAt,
    item.promotion?.valid_until,
    item.promotion?.validUntil
  );

  return {
    id: String(
      item.id ||
      item.deal_id ||
      item.dealId ||
      item.product_id ||
      item.productId ||
      item.product?.id ||
      `${retailer}-${slugify(name)}-${price}`
    ),

    retailer,
    name,
    brand: firstString(item.brand),
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
      item.product?.quantity,
      item.product?.package_size,
      item.product?.packageSize
    ),

    category: firstString(
      item.category?.name,
      item.category,
      item.category_name,
      item.categoryName,
      item.product?.category?.name,
      item.product?.category
    ),

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

    validFrom,
    validUntil,

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
      item.product?.imageUrl,
      item.product?.image
    ),
  };
}

function normalizeRetailer(value = '') {
  const normalized = String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (
    normalized === 'ah' ||
    (
      normalized.includes('albert') &&
      normalized.includes('heijn')
    )
  ) {
    return 'albert_heijn';
  }

  if (normalized.includes('hoogvliet')) {
    return 'hoogvliet';
  }

  if (normalized.includes('dirk')) {
    return 'dirk';
  }

  if (normalized.includes('lidl')) {
    return 'lidl';
  }

  if (
    normalized === 'plus' ||
    normalized.startsWith('plus_') ||
    normalized.endsWith('_plus')
  ) {
    return 'plus';
  }

  return normalized;
}

function firstString(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }

    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      return value.trim();
    }

    if (
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      return String(value);
    }
  }

  return null;
}

function numberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  if (!normalized) {
    return null;
  }

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function deduplicate(items) {
  const map = new Map();

  for (const item of items) {
    const key = [
      item.retailer,
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

async function preserveExisting(reason) {
  try {
    const existing = JSON.parse(
      await readFile(outputPath, 'utf8')
    );

    existing.meta ||= {};
    existing.meta.lastRefreshError = reason;
    existing.meta.lastRefreshAttempt =
      new Date().toISOString();

    await writeFile(
      outputPath,
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
