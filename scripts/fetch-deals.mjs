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

const apiKey =
  process.env.PRIJS_PROFEET_API_KEY || '';

const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/your-name/voorraadmaat';

const userAgent =
  `Voorraadmaat/1.1 (+${repository})`;

main().catch(async (error) => {
  console.error(
    `Deals refresh failed: ${error.stack || error}`
  );

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
  console.log(
    `API key configured: ${apiKey ? 'yes' : 'no'}`
  );

  /*
   * First try one combined request containing all retailers.
   */
  const combinedUrl = new URL(endpoint);

  for (const retailer of retailers) {
    combinedUrl.searchParams.append(
      'retailer',
      retailer
    );
  }

  let deals = [];

  try {
    const combinedPayload =
      await fetchJson(combinedUrl);

    const extracted =
      extractDeals(combinedPayload);

    console.log(
      `Combined response contained ${extracted.length} candidate item(s).`
    );

    deals.push(
      ...extracted
        .map(normalizeDeal)
        .filter(Boolean)
    );
  } catch (error) {
    console.warn(
      `Combined request failed: ${error.message}`
    );
  }

  /*
   * Determine which supermarkets are still missing.
   */
  let coveredRetailers = new Set(
    deals.map((deal) => deal.retailer)
  );

  let missingRetailers = retailers.filter(
    (retailer) => !coveredRetailers.has(retailer)
  );

  /*
   * If the combined request yielded nothing, request every
   * retailer separately. Otherwise request only missing ones.
   */
  if (!deals.length || missingRetailers.length) {
    const retailersToFetch = deals.length
      ? missingRetailers
      : retailers;

    console.log(
      `Trying separate requests for: ${retailersToFetch.join(', ')}`
    );

    const results = await Promise.allSettled(
      retailersToFetch.map(
        async (retailer) => {
          const url = new URL(endpoint);

          url.searchParams.set(
            'retailer',
            retailer
          );

          const payload =
            await fetchJson(url);

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
        }
      )
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
            result.reason?.message ||
            result.reason
          }`
        );
      }
    }
  }

  /*
   * Remove duplicate offers and discard unusable data.
   */
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

  console.log(
    `Final usable deal count: ${deals.length}`
  );

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
      sourceUrl:
        'https://www.prijsprofeet.nl',
      endpoint,
      retailers,
      coveredRetailers:
        [...coveredRetailers],
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
    headers.Authorization =
      `Bearer ${apiKey}`;
  }

  console.log(`Requesting: ${url}`);

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const responseText =
    await response.text();

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

  /*
   * This sample is useful while troubleshooting. It is
   * deliberately limited so the workflow log stays readable.
   */
  console.log(
    `Response sample: ${JSON.stringify(payload).slice(0, 1500)}`
  );

  return payload;
}

function describePayload(payload) {
  if (Array.isArray(payload)) {
    return `array with ${payload.length} item(s)`;
  }

  if (
    payload &&
    typeof payload === 'object'
  ) {
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
  if (
    depth > 8 ||
    payload == null
  ) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      if (
        item &&
        typeof item === 'object'
      ) {
        return [{
          ...item,
          retailer:
            item.retailer ||
            item.retailer_slug ||
            item.retailerSlug ||
            inheritedRetailer,
        }];
      }

      return [];
    });
  }

  if (typeof payload !== 'object') {
    return [];
  }

  /*
   * If the object itself already looks like a deal,
   * return it directly.
   */
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

  /*
   * Prefer likely result containers first.
   */
  for (const key of preferredKeys) {
    if (payload[key] == null) {
      continue;
    }

    const nested = extractDeals(
      payload[key],
      depth + 1,
      directRetailer
    );

    if (nested.length) {
      return nested;
    }
  }

  /*
   * Otherwise inspect every property recursively.
   */
  const collected = [];

  for (
    const [key, value]
    of Object.entries(payload)
  ) {
    const retailerFromKey =
      normalizeRetailer(key);

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

  const hasName = Boolean(
    value.name ||
    value.title ||
    value.product_name ||
    value.productName ||
    value.display_name ||
    value.displayName ||
    value.description ||
    value.product?.name ||
    value.product?.title
  );

  const hasPrice = [
    value.price,
    value.deal_price,
    value.dealPrice,
    value.current_price,
    value.currentPrice,
    value.offer_price,
    value.offerPrice,
    value.sale_price,
    value.salePrice,
    value.discount_price,
    value.discountPrice,
    value.product?.price,
    value.product?.deal_price,
    value.product?.dealPrice,
  ].some(
    (candidate) =>
      candidate !== undefined &&
      candidate !== null &&
      candidate !== ''
  );

  return hasName && hasPrice;
}

function normalizeDeal(raw) {
  if (
    !raw ||
    typeof raw !== 'object'
  ) {
    return null;
  }

  const retailerValue =
    raw.retailer?.slug ||
    raw.retailer?.name ||
    raw.retailer ||
    raw.retailer_slug ||
    raw.retailerSlug ||
    raw.store?.slug ||
    raw.store?.name ||
    raw.store ||
    raw.store_name ||
    raw.storeName ||
    raw.supermarket?.slug ||
    raw.supermarket?.name ||
    raw.supermarket;

  const retailer =
    normalizeRetailer(retailerValue);

  const name = firstString(
    raw.name,
    raw.title,
    raw.product_name,
    raw.productName,
    raw.display_name,
    raw.displayName,
    raw.description,
    raw.product?.name,
    raw.product?.title,
    raw.product?.description
  );

  const price = numberOrNull(
    raw.price ??
    raw.deal_price ??
    raw.dealPrice ??
    raw.current_price ??
    raw.currentPrice ??
    raw.offer_price ??
    raw.offerPrice ??
    raw.sale_price ??
    raw.salePrice ??
    raw.discount_price ??
    raw.discountPrice ??
    raw.product?.price ??
    raw.product?.deal_price ??
    raw.product?.dealPrice
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
    raw.original_price ??
    raw.originalPrice ??
    raw.regular_price ??
    raw.regularPrice ??
    raw.normal_price ??
    raw.normalPrice ??
    raw.list_price ??
    raw.listPrice ??
    raw.was_price ??
    raw.wasPrice ??
    raw.product?.original_price ??
    raw.product?.originalPrice
  );

  let discountPercentage = numberOrNull(
    raw.discount_percentage ??
    raw.discountPercentage ??
    raw.discount_percent ??
    raw.discountPercent ??
    raw.discount
  );

  if (
    discountPercentage == null &&
    originalPrice != null &&
    originalPrice > 0 &&
    price < originalPrice
  ) {
    discountPercentage =
      Math.round(
        (
          (
            originalPrice - price
          ) /
          originalPrice
        ) *
        100
      );
  }

  const validFrom = firstString(
    raw.valid_from,
    raw.validFrom,
    raw.start_date,
    raw.startDate,
    raw.starts_at,
    raw.startsAt,
    raw.promotion?.valid_from,
    raw.promotion?.validFrom
  );

  const validUntil = firstString(
    raw.valid_until,
    raw.validUntil,
    raw.end_date,
    raw.endDate,
    raw.ends_at,
    raw.endsAt,
    raw.promotion?.valid_until,
    raw.promotion?.validUntil
  );

  return {
    id: String(
      raw.id ||
      raw.deal_id ||
      raw.dealId ||
      raw.product_id ||
      raw.productId ||
      raw.product?.id ||
      `${retailer}-${slugify(name)}-${price}`
    ),

    retailer,
    name,
    price,
    originalPrice,
    discountPercentage,

    unitPrice: firstString(
      raw.unit_price,
      raw.unitPrice,
      raw.price_per_unit,
      raw.pricePerUnit,
      raw.product?.unit_price,
      raw.product?.unitPrice
    ),

    quantity: firstString(
      raw.quantity,
      raw.package_size,
      raw.packageSize,
      raw.size,
      raw.content,
      raw.product?.quantity,
      raw.product?.package_size,
      raw.product?.packageSize
    ),

    category: firstString(
      raw.category?.name,
      raw.category,
      raw.category_name,
      raw.categoryName,
      raw.product?.category?.name,
      raw.product?.category
    ),

    promotionType: firstString(
      raw.promotion_type,
      raw.promotionType,
      raw.offer_text,
      raw.offerText,
      raw.deal_text,
      raw.dealText,
      raw.promotion?.type,
      raw.promotion?.text
    ),

    promotionStatus: firstString(
      raw.promotion_status,
      raw.promotionStatus,
      raw.status,
      raw.promotion?.status
    ),

    validFrom,
    validUntil,

    url: firstString(
      raw.url,
      raw.product_url,
      raw.productUrl,
      raw.deal_url,
      raw.dealUrl,
      raw.product?.url
    ),

    imageUrl: firstString(
      raw.image_url,
      raw.imageUrl,
      raw.image,
      raw.thumbnail,
      raw.thumbnail_url,
      raw.thumbnailUrl,
      raw.product?.image_url,
      raw.product?.imageUrl,
      raw.product?.image
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
  if (
    value == null ||
    value === ''
  ) {
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
    .replace(
      /\.(?=\d{3}(?:\D|$))/g,
      ''
    )
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
      await readFile(
        outputPath,
        'utf8'
      )
    );

    existing.meta ||= {};
    existing.meta.lastRefreshError =
      reason;
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
