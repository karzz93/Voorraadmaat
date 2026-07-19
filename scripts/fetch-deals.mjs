#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, '../site/data/deals.json');
const endpoint = process.env.DEALS_API_URL || 'https://www.prijsprofeet.nl/api/v1/deals/top';
const retailers = ['albert_heijn', 'dirk', 'lidl', 'hoogvliet', 'plus'];
const apiKey = process.env.PRIJS_PROFEET_API_KEY || '';
const repository = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : 'https://github.com/your-name/voorraadmaat';
const userAgent = `Voorraadmaat/1.0 (+${repository})`;

main().catch(async (error) => {
  console.error(`Deals refresh failed: ${error.stack || error}`);
  if (process.env.STRICT_DEALS === '1') process.exitCode = 1;
  else await preserveExisting(`Refresh failed: ${error.message || error}`);
});

async function main() {
  const combinedUrl = new URL(endpoint);
  for (const retailer of retailers) combinedUrl.searchParams.append('retailer', retailer);

  let payloads = [];
  try {
    payloads.push(await fetchJson(combinedUrl));
  } catch (error) {
    console.warn(`Combined request failed (${error.message}); trying one retailer at a time.`);
  }

  let deals = payloads.flatMap(extractDeals).map(normalizeDeal).filter(Boolean);
  const coveredRetailers = new Set(deals.map((deal) => deal.retailer));
  const missingRetailers = retailers.filter((retailer) => !coveredRetailers.has(retailer));

  if (!deals.length || missingRetailers.length) {
    const perRetailer = await Promise.allSettled((deals.length ? missingRetailers : retailers).map(async (retailer) => {
      const url = new URL(endpoint);
      url.searchParams.set('retailer', retailer);
      const payload = await fetchJson(url);
      return extractDeals(payload).map((raw) => normalizeDeal({ ...raw, retailer: raw.retailer || retailer })).filter(Boolean);
    }));

    for (const result of perRetailer) {
      if (result.status === 'fulfilled') deals.push(...result.value);
      else console.warn(`Retailer request failed: ${result.reason?.message || result.reason}`);
    }
  }

  deals = deduplicate(deals)
    .filter((deal) => retailers.includes(deal.retailer) && deal.price != null)
    .sort((a, b) => a.retailer.localeCompare(b.retailer) || (b.discountPercentage || 0) - (a.discountPercentage || 0) || a.name.localeCompare(b.name, 'nl'));

  if (!deals.length) {
    throw new Error('The API returned no usable deals; existing data was kept.');
  }

  const output = {
    meta: {
      status: 'live',
      generatedAt: new Date().toISOString(),
      source: 'PrijsProfeet public deals API',
      sourceUrl: 'https://www.prijsprofeet.nl',
      endpoint,
      retailers,
      count: deals.length,
      attributionRequired: true,
    },
    deals,
  };

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${deals.length} deals to ${outputPath}.`);
}

async function fetchJson(url) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': userAgent,
  };
  if (apiKey) headers['X-API-Key'] = apiKey;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }
  return response.json();
}

function extractDeals(payload, depth = 0) {
  if (depth > 4 || payload == null) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];

  const preferredKeys = ['deals', 'items', 'results', 'products', 'offers', 'data'];
  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === 'object') {
      const nested = extractDeals(payload[key], depth + 1);
      if (nested.length) return nested;
    }
  }

  const retailerArrays = Object.entries(payload)
    .filter(([key, value]) => retailers.includes(normalizeRetailer(key)) && Array.isArray(value))
    .flatMap(([key, value]) => value.map((item) => ({ ...item, retailer: item.retailer || normalizeRetailer(key) })));
  if (retailerArrays.length) return retailerArrays;

  for (const value of Object.values(payload)) {
    const nested = extractDeals(value, depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function normalizeDeal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const retailerValue = raw.retailer?.slug || raw.retailer?.name || raw.retailer || raw.store?.slug || raw.store?.name || raw.store || raw.supermarket;
  const retailer = normalizeRetailer(retailerValue);
  const name = firstString(raw.name, raw.title, raw.product_name, raw.productName, raw.description, raw.product?.name);
  const price = numberOrNull(raw.price ?? raw.current_price ?? raw.currentPrice ?? raw.offer_price ?? raw.offerPrice ?? raw.product?.price);
  if (!retailer || !name || price == null) return null;

  const originalPrice = numberOrNull(raw.original_price ?? raw.originalPrice ?? raw.regular_price ?? raw.regularPrice ?? raw.was_price ?? raw.wasPrice);
  const discountPercentage = numberOrNull(raw.discount_percentage ?? raw.discountPercentage ?? raw.discount_percent ?? raw.discountPercent ?? raw.discount);
  const validFrom = firstString(raw.valid_from, raw.validFrom, raw.start_date, raw.startDate, raw.promotion?.valid_from);
  const validUntil = firstString(raw.valid_until, raw.validUntil, raw.end_date, raw.endDate, raw.promotion?.valid_until);

  return {
    id: String(raw.id || raw.product_id || raw.productId || raw.product?.id || `${retailer}-${slugify(name)}-${price}`),
    retailer,
    name,
    price,
    originalPrice,
    discountPercentage,
    unitPrice: firstString(raw.unit_price, raw.unitPrice, raw.product?.unit_price),
    quantity: firstString(raw.quantity, raw.package_size, raw.packageSize, raw.product?.quantity),
    category: firstString(raw.category?.name, raw.category, raw.category_name, raw.categoryName),
    promotionType: firstString(raw.promotion_type, raw.promotionType, raw.offer_text, raw.offerText, raw.promotion?.type),
    promotionStatus: firstString(raw.promotion_status, raw.promotionStatus, raw.status, raw.promotion?.status),
    validFrom,
    validUntil,
    url: firstString(raw.url, raw.product_url, raw.productUrl, raw.product?.url),
    imageUrl: firstString(raw.image_url, raw.imageUrl, raw.image, raw.product?.image_url),
  };
}

function normalizeRetailer(value = '') {
  const normalized = String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized === 'ah' || (normalized.includes('albert') && normalized.includes('heijn'))) return 'albert_heijn';
  if (normalized.includes('hoogvliet')) return 'hoogvliet';
  if (normalized.includes('dirk')) return 'dirk';
  if (normalized.includes('lidl')) return 'lidl';
  if (normalized === 'plus' || normalized.startsWith('plus_')) return 'plus';
  return normalized;
}

function firstString(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
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
    const key = `${item.retailer}|${slugify(item.name)}|${item.price}|${item.validUntil || ''}`;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

async function preserveExisting(reason) {
  try {
    const existing = JSON.parse(await readFile(outputPath, 'utf8'));
    existing.meta ||= {};
    existing.meta.lastRefreshError = reason;
    existing.meta.lastRefreshAttempt = new Date().toISOString();
    await writeFile(outputPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
    console.warn(`${reason} Existing deals file was preserved.`);
  } catch (error) {
    console.warn(`${reason} Existing file could not be updated: ${error.message}`);
  }
}
