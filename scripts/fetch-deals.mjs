#!/usr/bin/env node

import * as cheerio from 'cheerio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://www.prijsprofeet.nl';

const OUTPUT_PATH = path.resolve(
  __dirname,
  '../site/data/deals.json'
);

const INDEX_PATH = path.resolve(
  __dirname,
  '../site/data/deal-index.json'
);

const RETAILERS = [
  {
    id: 'albert_heijn',
    slug: 'albert-heijn',
    label: 'Albert Heijn',
  },
  {
    id: 'dirk',
    slug: 'dirk',
    label: 'Dirk',
  },
  {
    id: 'lidl',
    slug: 'lidl',
    label: 'Lidl',
  },
  {
    id: 'hoogvliet',
    slug: 'hoogvliet',
    label: 'Hoogvliet',
  },
  {
    id: 'plus',
    slug: 'plus',
    label: 'PLUS',
  },
];

const REQUEST_DELAY_MS = positiveInteger(
  process.env.DEALS_REQUEST_DELAY_MS,
  400
);

const REQUEST_TIMEOUT_MS = positiveInteger(
  process.env.DEALS_REQUEST_TIMEOUT_MS,
  45_000
);

const MAX_RETRIES = positiveInteger(
  process.env.DEALS_MAX_RETRIES,
  4
);

const MAX_PAGES_PER_RETAILER = positiveInteger(
  process.env.DEALS_MAX_PAGES,
  300
);

const MINIMUM_TOTAL_DEALS = positiveInteger(
  process.env.DEALS_MINIMUM_TOTAL,
  100
);

const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/your-name/voorraadmaat';

const USER_AGENT =
  `Voorraadmaat/5.0 (+${repository}; deal indexer)`;

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
  console.log(
    'Refreshing supermarket deals from listing pages.'
  );

  console.log(
    `Retailers: ${RETAILERS.map(
      (retailer) => retailer.label
    ).join(', ')}`
  );

  const allDeals = [];
  const retailerStats = {};

  for (const retailer of RETAILERS) {
    try {
      const result = await scrapeRetailer(retailer);

      retailerStats[retailer.id] = {
        status: 'success',
        pagesFetched: result.pagesFetched,
        reportedPages: result.reportedPages,
        reportedDeals: result.reportedDeals,
        parsedDeals: result.deals.length,
      };

      allDeals.push(...result.deals);
    } catch (error) {
      console.error(
        `${retailer.label} failed: ${error.message}`
      );

      retailerStats[retailer.id] = {
        status: 'failed',
        error: error.message,
        pagesFetched: 0,
        parsedDeals: 0,
      };
    }
  }

  const deals = deduplicate(allDeals)
    .filter(isUsableDeal)
    .sort(sortDeals);

  if (deals.length < MINIMUM_TOTAL_DEALS) {
    throw new Error(
      `Only ${deals.length} deals were parsed. ` +
      `Minimum required: ${MINIMUM_TOTAL_DEALS}.`
    );
  }

  const coveredRetailers = [
    ...new Set(
      deals.map((deal) => deal.retailer)
    ),
  ];

  const missingRetailers = RETAILERS
    .map((retailer) => retailer.id)
    .filter(
      (retailer) =>
        !coveredRetailers.includes(retailer)
    );

  const retailerCounts = countBy(
    deals,
    (deal) => deal.retailer
  );

  const categoryCounts = countBy(
    deals,
    (deal) => deal.category || 'Overig'
  );

  const generatedAt = new Date().toISOString();

  const output = {
    meta: {
      status: 'live',
      generatedAt,
      source:
        'PrijsProfeet public supermarket listing pages',
      sourceUrl: `${BASE_URL}/aanbiedingen/`,
      retailers: RETAILERS.map(
        (retailer) => retailer.id
      ),
      coveredRetailers,
      missingRetailers,
      count: deals.length,
      retailerCounts,
      categoryCounts,
      retailerStats,
      attributionRequired: true,
      note:
        'Prices are indicative. Verify prices and conditions with the supermarket.',
    },
    deals,
  };

  const index = buildDealIndex(
    deals,
    generatedAt
  );

  await mkdir(
    path.dirname(OUTPUT_PATH),
    { recursive: true }
  );

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

  console.log('');
  console.log(`Total deals written: ${deals.length}`);

  for (const retailer of RETAILERS) {
    console.log(
      `${retailer.label}: ` +
      `${retailerCounts[retailer.id] || 0}`
    );
  }

  console.log(`Written to ${OUTPUT_PATH}`);
  console.log(`Written to ${INDEX_PATH}`);
}

async function scrapeRetailer(retailer) {
  console.log('');
  console.log(`=== ${retailer.label} ===`);

  const firstUrl =
    `${BASE_URL}/aanbiedingen/${retailer.slug}/`;

  const firstHtml = await fetchHtml(firstUrl);

  const firstPage = parseListingPage({
    html: firstHtml,
    retailer,
    pageUrl: firstUrl,
  });

  if (!firstPage.deals.length) {
    throw new Error(
      'Page 1 contained no parseable products.'
    );
  }

  const reportedPages = Math.min(
    firstPage.totalPages || 1,
    MAX_PAGES_PER_RETAILER
  );

  console.log(
    `Page 1: ${firstPage.deals.length} products.`
  );

  console.log(
    `Reported pages: ${reportedPages}.`
  );

  if (firstPage.reportedDeals) {
    console.log(
      `Reported total products: ` +
      `${firstPage.reportedDeals}.`
    );
  }

  const deals = [...firstPage.deals];
  const seenFingerprints = new Set([
    createPageFingerprint(firstPage.deals),
  ]);

  let pagesFetched = 1;

  for (
    let page = 2;
    page <= reportedPages;
    page += 1
  ) {
    await sleep(REQUEST_DELAY_MS);

    const pageUrl =
      `${BASE_URL}/aanbiedingen/` +
      `${retailer.slug}/?page=${page}`;

    const html = await fetchHtml(pageUrl);

    const parsed = parseListingPage({
      html,
      retailer,
      pageUrl,
    });

    if (!parsed.deals.length) {
      console.warn(
        `Page ${page} contained no products. Stopping.`
      );
      break;
    }

    const fingerprint =
      createPageFingerprint(parsed.deals);

    if (seenFingerprints.has(fingerprint)) {
      console.warn(
        `Page ${page} repeated an earlier page. ` +
        `Stopping pagination.`
      );
      break;
    }

    seenFingerprints.add(fingerprint);
    deals.push(...parsed.deals);
    pagesFetched += 1;

    if (
      page % 10 === 0 ||
      page === reportedPages
    ) {
      console.log(
        `Page ${page}/${reportedPages}: ` +
        `${deals.length} products collected.`
      );
    }
  }

  const uniqueDeals = deduplicate(deals);

  console.log(
    `${retailer.label}: ` +
    `${uniqueDeals.length} unique products.`
  );

  return {
    deals: uniqueDeals,
    pagesFetched,
    reportedPages,
    reportedDeals: firstPage.reportedDeals,
  };
}

async function fetchHtml(url) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt += 1
  ) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept:
            'text/html,application/xhtml+xml,' +
            'application/xml;q=0.9,*/*;q=0.8',

          'Accept-Language':
            'nl-NL,nl;q=0.9,en;q=0.7',

          'Cache-Control': 'no-cache',
          'User-Agent': USER_AGENT,
        },

        redirect: 'follow',

        signal: AbortSignal.timeout(
          REQUEST_TIMEOUT_MS
        ),
      });

      if (
        response.status === 429 ||
        response.status >= 500
      ) {
        throw new Error(
          `${response.status} ` +
          `${response.statusText}`
        );
      }

      if (!response.ok) {
        throw new Error(
          `${response.status} ` +
          `${response.statusText}`
        );
      }

      const html = await response.text();

      if (
        !html ||
        html.length < 1_000
      ) {
        throw new Error(
          'The response contained too little HTML.'
        );
      }

      return html;
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_RETRIES) {
        break;
      }

      const waitMilliseconds =
        REQUEST_DELAY_MS +
        (2 ** (attempt - 1)) * 1_000;

      console.warn(
        `Request ${attempt}/${MAX_RETRIES} ` +
        `failed for ${url}: ${error.message}. ` +
        `Retrying in ${waitMilliseconds} ms.`
      );

      await sleep(waitMilliseconds);
    }
  }

  throw new Error(
    `Could not retrieve ${url}: ` +
    `${lastError?.message || lastError}`
  );
}

function parseListingPage({
  html,
  retailer,
  pageUrl,
}) {
  const $ = cheerio.load(html);

  const bodyText = normalizeWhitespace(
    $('body').text()
  );

  const totalPages =
    findMaximumPageNumber($) ||
    parseInteger(
      bodyText.match(
        /pagina\s+\d+\s+van\s+(\d+)/i
      )?.[1]
    ) ||
    1;

  const reportedDeals =
    parseInteger(
      bodyText.match(
        /heeft\s+deze\s+week\s+([\d.]+)\s+producten/i
      )?.[1]
    ) ||
    parseInteger(
      bodyText.match(
        /bekijk\s+([\d.]+)\s+.+?\s+aanbiedingen/i
      )?.[1]
    ) ||
    null;

  const jsonLdDeals = extractJsonLdDeals({
    $,
    retailer,
    pageUrl,
  });

  const cardDeals = extractCardDeals({
    $,
    retailer,
    pageUrl,
  });

  const deals = deduplicate([
    ...jsonLdDeals,
    ...cardDeals,
  ]);

  return {
    deals,
    totalPages,
    reportedDeals,
  };
}

function extractJsonLdDeals({
  $,
  retailer,
  pageUrl,
}) {
  const deals = [];

  $('script[type="application/ld+json"]')
    .each((_, element) => {
      const text = $(element).text().trim();

      if (!text) {
        return;
      }

      try {
        const data = JSON.parse(text);

        walkJsonLd(
          data,
          (item) => {
            const deal = normalizeJsonLdProduct({
              item,
              retailer,
              pageUrl,
            });

            if (deal) {
              deals.push(deal);
            }
          }
        );
      } catch {
        // Ignore malformed JSON-LD blocks.
      }
    });

  return deals;
}

function walkJsonLd(value, callback) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkJsonLd(item, callback);
    }

    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const type = String(
    value['@type'] || ''
  ).toLowerCase();

  if (
    type === 'product' ||
    value.item?.['@type'] === 'Product'
  ) {
    callback(value.item || value);
  }

  for (const child of Object.values(value)) {
    if (
      child &&
      typeof child === 'object'
    ) {
      walkJsonLd(child, callback);
    }
  }
}

function normalizeJsonLdProduct({
  item,
  retailer,
  pageUrl,
}) {
  const name = firstString(
    item.name,
    item.headline
  );

  const offer = Array.isArray(item.offers)
    ? item.offers[0]
    : item.offers;

  const price = parseDutchNumber(
    offer?.price ||
    offer?.lowPrice ||
    item.price
  );

  if (!name || price == null) {
    return null;
  }

  const productUrl = absoluteUrl(
    item.url ||
    offer?.url ||
    pageUrl
  );

  const imageValue = Array.isArray(item.image)
    ? item.image[0]
    : item.image;

  return createDeal({
    retailer,
    name,
    brand: firstString(
      item.brand?.name,
      item.brand
    ),
    price,
    originalPrice: null,
    promotionText: null,
    validUntil: normalizeDate(
      offer?.priceValidUntil
    ),
    productUrl,
    imageUrl: absoluteUrl(imageValue),
    pageUrl,
  });
}

function extractCardDeals({
  $,
  retailer,
  pageUrl,
}) {
  const deals = [];
  const processedUrls = new Set();

  const productLinks = $(
    [
      'a[href*="/product/"]',
      'a[href*="/producten/"]',
      'a[href*="/aanbieding/"]',
    ].join(',')
  );

  productLinks.each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');

    if (!href) {
      return;
    }

    const productUrl = absoluteUrl(href);

    if (
      !productUrl ||
      processedUrls.has(productUrl)
    ) {
      return;
    }

    const card = findBestCard(
      $,
      anchor
    );

    if (!card) {
      return;
    }

    const deal = parseCard({
      $,
      card,
      anchor,
      retailer,
      productUrl,
      pageUrl,
    });

    if (!deal) {
      return;
    }

    processedUrls.add(productUrl);
    deals.push(deal);
  });

  /*
   * Fallback for cards where the product link does not
   * use one of the recognised URL patterns.
   */
  if (!deals.length) {
    $(
      'article, li, [class*="product"], [class*="deal"]'
    ).each((_, element) => {
      const card = $(element);

      const text = normalizeWhitespace(
        card.text()
      );

      if (
        !text.includes('€') ||
        text.length < 10 ||
        text.length > 1_500
      ) {
        return;
      }

      const anchor = card.find('a').first();

      const deal = parseCard({
        $,
        card,
        anchor,
        retailer,
        productUrl: absoluteUrl(
          anchor.attr('href') || pageUrl
        ),
        pageUrl,
      });

      if (deal) {
        deals.push(deal);
      }
    });
  }

  return deals;
}

function findBestCard($, anchor) {
  let node = anchor;
  let bestCard = null;
  let bestScore = -1;

  for (
    let depth = 0;
    depth < 9;
    depth += 1
  ) {
    node = node.parent();

    if (!node?.length) {
      break;
    }

    const text = normalizeWhitespace(
      node.text()
    );

    if (
      text.length < 10 ||
      text.length > 2_000
    ) {
      continue;
    }

    const euroCount =
      (text.match(/€\s*\d/gi) || []).length;

    const linkCount =
      node.find('a').length;

    const productLinkCount =
      node.find(
        'a[href*="/product/"],' +
        'a[href*="/producten/"],' +
        'a[href*="/aanbieding/"]'
      ).length;

    let score = 0;

    if (euroCount >= 1) score += 4;
    if (euroCount >= 2) score += 1;
    if (productLinkCount === 1) score += 4;
    if (linkCount <= 5) score += 2;
    if (node.find('img').length) score += 1;

    if (
      /\b(?:bonus|actie|gratis|korting)\b/i
        .test(text)
    ) {
      score += 1;
    }

    if (
      /\bt\/m\s+\d{1,2}-\d{1,2}\b/i
        .test(text)
    ) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = node;
    }

    if (score >= 10) {
      break;
    }
  }

  return bestScore >= 5
    ? bestCard
    : null;
}

function parseCard({
  $,
  card,
  anchor,
  retailer,
  productUrl,
  pageUrl,
}) {
  const text = normalizeWhitespace(
    card.text()
  );

  const name = extractProductName({
    card,
    anchor,
    text,
  });

  if (!name) {
    return null;
  }

  const prices = extractPrices(text);

  if (!prices.length) {
    return null;
  }

  const price = prices[0];

  const originalPrice =
    prices.length >= 2 &&
    prices[1] > price
      ? prices[1]
      : null;

  const explicitDiscount =
    parseDutchNumber(
      text.match(
        /[-−]\s*(\d{1,3})\s*%/
      )?.[1]
    );

  const discountPercentage =
    explicitDiscount ??
    (
      originalPrice != null
        ? round2(
            (
              (originalPrice - price) /
              originalPrice
            ) * 100
          )
        : null
    );

  const validUntil = extractValidUntil(text);

  const promotionText =
    extractPromotionText(text);

  const image = card.find('img').first();

  const imageUrl = absoluteUrl(
    image.attr('src') ||
    image.attr('data-src') ||
    image.attr('data-lazy-src') ||
    image.attr('srcset')?.split(' ')[0] ||
    ''
  );

  const brand = extractBrand({
    card,
    name,
  });

  return createDeal({
    retailer,
    name,
    brand,
    price,
    originalPrice,
    discountPercentage,
    promotionText,
    validUntil,
    productUrl,
    imageUrl,
    pageUrl,
  });
}

function createDeal({
  retailer,
  name,
  brand,
  price,
  originalPrice,
  discountPercentage,
  promotionText,
  validUntil,
  productUrl,
  imageUrl,
  pageUrl,
}) {
  const category = inferCategory(name);

  const savingsAmount =
    originalPrice != null &&
    originalPrice > price
      ? round2(originalPrice - price)
      : null;

  return {
    id:
      productUrl.match(
        /\/(?:product|producten|aanbieding)\/([^/?#]+)/
      )?.[1] ||
      `${retailer.id}-${slugify(name)}-${price}`,

    retailer: retailer.id,
    name,
    brand: brand || null,
    price,
    originalPrice,
    discountPercentage:
      discountPercentage ?? null,
    savingsAmount,
    unitPrice: null,
    quantity: null,
    category,
    promotionType:
      promotionText || null,
    promotionStatus: 'active',
    validFrom: null,
    validUntil,
    ean: null,
    url: productUrl || pageUrl,
    imageUrl: imageUrl || null,
    sourcePage: pageUrl,

    searchTokens: tokenize(
      [
        name,
        brand,
        category,
        promotionText,
      ]
        .filter(Boolean)
        .join(' ')
    ),
  };
}

function extractProductName({
  card,
  anchor,
  text,
}) {
  const candidates = [
    anchor.attr('aria-label'),
    anchor.attr('title'),
    anchor.find('h2,h3,h4').first().text(),
    card.find('h2,h3,h4').first().text(),
    anchor.text(),
    card.find('[class*="title"]').first().text(),
    card.find('[class*="name"]').first().text(),
    card.find('img').first().attr('alt'),
  ];

  for (const candidate of candidates) {
    const normalized =
      cleanProductName(candidate);

    if (
      normalized &&
      normalized.length >= 2 &&
      normalized.length <= 200 &&
      !normalized.includes('€') &&
      !looksLikeNavigationText(normalized)
    ) {
      return normalized;
    }
  }

  const beforePrice = text
    .split(/€\s*\d/)[0]
    .trim();

  const fallback =
    cleanProductName(beforePrice);

  return fallback.length >= 2
    ? fallback
    : null;
}

function cleanProductName(value = '') {
  return normalizeWhitespace(value)
    .replace(
      /^(nieuw|actie|bonus|aanbieding)\s+/i,
      ''
    )
    .replace(
      /[-−]\s*\d{1,3}\s*%\s*/g,
      ''
    )
    .trim();
}

function looksLikeNavigationText(value) {
  return [
    'bekijk aanbieding',
    'bekijk product',
    'meer informatie',
    'volgende',
    'vorige',
    'alle aanbiedingen',
  ].includes(value.toLowerCase());
}

function extractBrand({
  card,
  name,
}) {
  const candidates = [
    card.find('[class*="brand"]').first().text(),
    card.find('[data-brand]').first().attr('data-brand'),
    card.find('img').first().attr('alt'),
  ];

  for (const candidate of candidates) {
    const brand = normalizeWhitespace(
      candidate
    );

    if (
      brand &&
      brand !== name &&
      brand.length <= 80 &&
      !brand.includes('€')
    ) {
      return brand;
    }
  }

  return null;
}

function extractPrices(text) {
  const values = [];

  const patterns = [
    /€\s*([\d.]+(?:,\d{1,2})?)/g,
    /\b(?:voor|nu)\s+([\d]+[,.]\d{2})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value =
        parseDutchNumber(match[1]);

      if (
        value != null &&
        value >= 0.01 &&
        value < 10_000
      ) {
        values.push(value);
      }
    }

    if (values.length) {
      break;
    }
  }

  return values;
}

function extractValidUntil(text) {
  const match = text.match(
    /\bt\/m\s+(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?\b/i
  );

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);

  let year = match[3]
    ? Number(match[3])
    : new Date().getUTCFullYear();

  if (year < 100) {
    year += 2000;
  }

  let date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      23,
      59,
      59
    )
  );

  const now = new Date();

  if (
    !match[3] &&
    date.getTime() <
      now.getTime() -
      45 * 24 * 60 * 60 * 1_000
  ) {
    date = new Date(
      Date.UTC(
        year + 1,
        month - 1,
        day,
        23,
        59,
        59
      )
    );
  }

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function extractPromotionText(text) {
  const patterns = [
    /\b\d+\s*\+\s*\d+\s*gratis\b/i,
    /\b\d+e\s+gratis\b/i,
    /\b\d+e\s+halve\s+prijs\b/i,
    /\b\d{1,3}\s*%\s+korting\b/i,
    /\bbonus\b/i,
    /\bactie\b/i,
    /\bvoor\s+€?\s*[\d.,]+\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return normalizeWhitespace(
        match[0]
      );
    }
  }

  return null;
}

function findMaximumPageNumber($) {
  let maximum = 1;

  $('a[href*="?page="], a[href*="&page="]')
    .each((_, element) => {
      const href =
        $(element).attr('href') || '';

      const match = href.match(
        /[?&]page=(\d+)/i
      );

      if (!match) {
        return;
      }

      const page = Number(match[1]);

      if (
        Number.isInteger(page) &&
        page > maximum
      ) {
        maximum = page;
      }
    });

  return maximum;
}

function buildDealIndex(
  deals,
  generatedAt
) {
  return {
    version: 3,
    generatedAt,

    retailers: RETAILERS.map(
      (retailer) => retailer.id
    ),

    entries: deals.map(
      (deal, index) => ({
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
        t: deal.searchTokens || [],
        u: deal.url || '',
        m: deal.imageUrl || '',
        v: deal.validUntil || '',
        x: deal.promotionType || '',
      })
    ),
  };
}

function inferCategory(productName) {
  const text = normalizeText(productName);

  const rules = [
    [
      'Groente & Fruit',
      [
        'groente',
        'fruit',
        'appel',
        'banaan',
        'tomaat',
        'aardappel',
        'salade',
        'komkommer',
        'paprika',
        'ui',
        'sinaasappel',
      ],
    ],

    [
      'Zuivel & Eieren',
      [
        'melk',
        'yoghurt',
        'kwark',
        'ei',
        'eieren',
        'boter',
        'room',
        'vla',
      ],
    ],

    [
      'Vlees & Gevogelte',
      [
        'vlees',
        'kip',
        'gehakt',
        'worst',
        'burger',
        'biefstuk',
        'schnitzel',
      ],
    ],

    [
      'Vis & Zeevruchten',
      [
        'vis',
        'zalm',
        'tonijn',
        'garnaal',
        'kabeljauw',
        'haring',
      ],
    ],

    [
      'Kaas & Vleeswaren',
      [
        'kaas',
        'ham',
        'salami',
        'vleeswaren',
        'filet americain',
      ],
    ],

    [
      'Brood & Bakkerij',
      [
        'brood',
        'bol',
        'croissant',
        'bakkerij',
        'wrap',
        'stokbrood',
      ],
    ],

    [
      'Ontbijt & Beleg',
      [
        'muesli',
        'cornflakes',
        'hagelslag',
        'jam',
        'pindakaas',
        'ontbijt',
      ],
    ],

    [
      'Pasta, Rijst & Wereldkeuken',
      [
        'pasta',
        'rijst',
        'noedel',
        'couscous',
        'tortilla',
        'spaghetti',
        'macaroni',
      ],
    ],

    [
      'Soepen, Conserven & Sauzen',
      [
        'soep',
        'saus',
        'blik',
        'tomatenblokjes',
        'mayonaise',
        'ketchup',
      ],
    ],

    [
      'Snoep, Koek & Chips',
      [
        'snoep',
        'koek',
        'chips',
        'chocolade',
        'drop',
        'reep',
      ],
    ],

    [
      'Frisdrank & Sappen',
      [
        'frisdrank',
        'sap',
        'cola',
        'limonade',
        'water',
        'smoothie',
      ],
    ],

    [
      'Koffie & Thee',
      [
        'koffie',
        'thee',
        'capsule',
      ],
    ],

    [
      'Bier, Wijn & Dranken',
      [
        'bier',
        'wijn',
        'prosecco',
        'whisky',
        'gin',
        'vodka',
      ],
    ],

    [
      'Diepvries',
      [
        'diepvries',
        'bevroren',
        'ijs',
        'pizza',
      ],
    ],

    [
      'Vega & Plantaardig',
      [
        'vega',
        'vegan',
        'plantaardig',
        'tofu',
        'vegetarisch',
      ],
    ],

    [
      'Huishouden & Dier',
      [
        'wasmiddel',
        'toiletpapier',
        'schoonmaak',
        'vaatwas',
        'kat',
        'hond',
      ],
    ],

    [
      'Drogisterij & Baby',
      [
        'shampoo',
        'tandpasta',
        'deodorant',
        'luier',
        'baby',
        'douchegel',
      ],
    ],
  ];

  for (const [category, words] of rules) {
    if (
      words.some(
        (word) => text.includes(word)
      )
    ) {
      return category;
    }
  }

  return 'Overig';
}

function createPageFingerprint(deals) {
  return deals
    .slice(0, 10)
    .map(
      (deal) =>
        [
          deal.id,
          deal.name,
          deal.price,
        ].join(':')
    )
    .join('|');
}

function isUsableDeal(deal) {
  return Boolean(
    deal &&
    deal.retailer &&
    deal.name &&
    Number.isFinite(deal.price) &&
    deal.price > 0
  );
}

function sortDeals(a, b) {
  return (
    a.retailer.localeCompare(
      b.retailer
    ) ||

    (b.discountPercentage || 0) -
      (a.discountPercentage || 0) ||

    a.name.localeCompare(
      b.name,
      'nl'
    )
  );
}

function deduplicate(items) {
  const map = new Map();

  for (const item of items) {
    const key =
      item.url ||
      [
        item.retailer,
        slugify(item.name),
        item.price,
        item.validUntil || '',
      ].join('|');

    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      continue;
    }

    /*
     * Prefer the record with more useful fields.
     */
    const existingScore =
      completenessScore(existing);

    const newScore =
      completenessScore(item);

    if (newScore > existingScore) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

function completenessScore(item) {
  return [
    item.brand,
    item.originalPrice,
    item.discountPercentage,
    item.promotionType,
    item.validUntil,
    item.imageUrl,
  ].filter(
    (value) =>
      value !== null &&
      value !== undefined &&
      value !== ''
  ).length;
}

function countBy(items, selector) {
  const counts = new Map();

  for (const item of items) {
    const key = selector(item);

    counts.set(
      key,
      (counts.get(key) || 0) + 1
    );
  }

  return Object.fromEntries(
    [...counts.entries()].sort(
      (a, b) => b[1] - a[1]
    )
  );
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

function parseDutchNumber(value) {
  if (
    value == null ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'number'
  ) {
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

function parseInteger(value) {
  if (
    value == null ||
    value === ''
  ) {
    return null;
  }

  const number = Number(
    String(value).replace(/\./g, '')
  );

  return Number.isInteger(number)
    ? number
    : null;
}

function positiveInteger(
  value,
  fallback
) {
  const parsed = Number.parseInt(
    String(value || ''),
    10
  );

  return (
    Number.isInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function normalizeWhitespace(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .trim();
}

function tokenize(value) {
  return [
    ...new Set(
      normalizeText(value)
        .split(/\s+/)
        .filter(
          (token) => token.length >= 2
        )
    ),
  ];
}

function slugify(value) {
  return normalizeText(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function absoluteUrl(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(
      value,
      BASE_URL
    ).href;
  } catch {
    return '';
  }
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date.toISOString();
}

function round2(value) {
  return (
    Math.round(
      Number(value) * 100
    ) / 100
  );
}

function sleep(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

async function preserveExisting(reason) {
  try {
    const existing = JSON.parse(
      await readFile(
        OUTPUT_PATH,
        'utf8'
      )
    );

    existing.meta ||= {};

    existing.meta.lastRefreshError =
      reason;

    existing.meta.lastRefreshAttempt =
      new Date().toISOString();

    await writeFile(
      OUTPUT_PATH,
      `${JSON.stringify(
        existing,
        null,
        2
      )}\n`,
      'utf8'
    );

    console.warn(
      `${reason} Existing deal data was preserved.`
    );
  } catch (error) {
    console.warn(
      `${reason} Existing file could not be updated: ` +
      `${error.message}`
    );
  }
}
