/*
 * Voorraadmaat smart deal matcher
 *
 * Browser usage:
 *   import {
 *     loadDealIndex,
 *     optimizeShoppingList
 *   } from './deals-engine.js';
 *
 *   const index = await loadDealIndex();
 *   const result = optimizeShoppingList(shoppingItems, index);
 */

const DEFAULT_RETAILERS = [
  'albert_heijn',
  'dirk',
  'lidl',
  'hoogvliet',
  'plus',
];

const RETAILER_LABELS = {
  albert_heijn: 'Albert Heijn',
  dirk: 'Dirk',
  lidl: 'Lidl',
  hoogvliet: 'Hoogvliet',
  plus: 'PLUS',
};

const STOP_WORDS = new Set([
  'de',
  'het',
  'een',
  'en',
  'van',
  'voor',
  'met',
  'zonder',
  'pak',
  'pakken',
  'blik',
  'blikken',
  'fles',
  'flessen',
  'stuk',
  'stuks',
  'gram',
  'kg',
  'kilo',
  'liter',
  'ml',
  'g',
  'l',
  'x',
]);

const SYNONYMS = {
  aardappels: 'aardappel',
  aardappelen: 'aardappel',
  tomaten: 'tomaat',
  uien: 'ui',
  eieren: 'ei',
  wraps: 'wrap',
  tortillas: 'wrap',
  tortilla: 'wrap',
  spaghetti: 'pasta',
  macaroni: 'pasta',
  penne: 'pasta',
  kipfilet: 'kip',
  gehaktballen: 'gehakt',
  fris: 'frisdrank',
  cola_zero: 'cola',
  yoghurt: 'yoghurt',
};

export async function loadDealIndex(url = './data/deal-index.json') {
  const response = await fetch(
    `${url}?v=${Date.now()}`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    throw new Error(
      `Deal index could not be loaded (${response.status}).`
    );
  }

  return response.json();
}

export function optimizeShoppingList(
  shoppingItems,
  dealIndex,
  options = {}
) {
  const {
    retailers = DEFAULT_RETAILERS,
    maxStores = 2,
    minimumMatchScore = 0.42,
    visitCost = 2.5,
    preferredRetailers = [],
  } = options;

  const entries = Array.isArray(dealIndex)
    ? dealIndex
    : dealIndex?.entries || [];

  const normalizedItems = shoppingItems
    .map(normalizeShoppingItem)
    .filter((item) => item.name);

  const matches = normalizedItems.map((item) => ({
    item,
    candidates: findDealCandidates(
      item,
      entries,
      retailers,
      minimumMatchScore
    ),
  }));

  const singleStorePlans = retailers.map((retailer) =>
    buildPlan(matches, [retailer], {
      visitCost: 0,
      preferredRetailers,
    })
  );

  const combinations = maxStores >= 2
    ? pairCombinations(retailers)
    : [];

  const multiStorePlans = combinations.map((stores) =>
    buildPlan(matches, stores, {
      visitCost,
      preferredRetailers,
    })
  );

  const plans = [
    ...singleStorePlans,
    ...multiStorePlans,
  ].sort(comparePlans);

  const bestSingleStore = singleStorePlans
    .slice()
    .sort(comparePlans)[0] || null;

  const bestPlan = plans[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    items: normalizedItems,
    matches,
    bestPlan,
    bestSingleStore,
    alternatives: plans.slice(1, 5),
    savingsFromSecondStore:
      bestPlan &&
      bestSingleStore &&
      bestPlan.stores.length > 1
        ? roundMoney(
            bestSingleStore.estimatedTotal -
            bestPlan.estimatedTotal
          )
        : 0,
  };
}

export function findDealCandidates(
  item,
  entries,
  retailers = DEFAULT_RETAILERS,
  minimumScore = 0.42
) {
  const itemTokens = new Set(tokenize(item.name));
  const itemCategory = normalizeText(item.category || '');

  return entries
    .filter((deal) => retailers.includes(deal.r))
    .map((deal) => {
      const dealTokens = new Set(
        Array.isArray(deal.t)
          ? deal.t
          : tokenize(
              `${deal.n || ''} ${deal.b || ''} ${deal.c || ''}`
            )
      );

      const score = calculateMatchScore({
        itemTokens,
        dealTokens,
        itemName: item.name,
        dealName: deal.n || '',
        itemCategory,
        dealCategory: normalizeText(deal.c || ''),
        itemEan: item.ean,
        dealEan: deal.e,
      });

      return {
        deal,
        score,
      };
    })
    .filter(({ score }) => score >= minimumScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.deal.p - b.deal.p ||
        (b.deal.d || 0) - (a.deal.d || 0)
    )
    .slice(0, 20);
}

function buildPlan(
  matches,
  stores,
  {
    visitCost,
    preferredRetailers,
  }
) {
  const assignments = [];
  const unmatched = [];
  let productTotal = 0;
  let referenceTotal = 0;

  for (const { item, candidates } of matches) {
    const eligible = candidates
      .filter(({ deal }) => stores.includes(deal.r))
      .sort(
        (a, b) =>
          adjustedDealCost(a, preferredRetailers) -
            adjustedDealCost(b, preferredRetailers) ||
          b.score - a.score
      );

    const selected = eligible[0];

    if (!selected) {
      unmatched.push(item);
      continue;
    }

    const quantity = Number(item.quantity) > 0
      ? Number(item.quantity)
      : 1;

    const lineTotal = selected.deal.p * quantity;
    const originalUnitPrice =
      Number(selected.deal.o) > selected.deal.p
        ? Number(selected.deal.o)
        : selected.deal.p;

    productTotal += lineTotal;
    referenceTotal += originalUnitPrice * quantity;

    assignments.push({
      shoppingItem: item,
      retailer: selected.deal.r,
      retailerLabel:
        RETAILER_LABELS[selected.deal.r] ||
        selected.deal.r,
      deal: selected.deal,
      matchScore: roundMoney(selected.score),
      quantity,
      lineTotal: roundMoney(lineTotal),
      estimatedSaving: roundMoney(
        Math.max(
          0,
          (originalUnitPrice - selected.deal.p) * quantity
        )
      ),
    });
  }

  const actualStores = [
    ...new Set(assignments.map((assignment) => assignment.retailer)),
  ];

  const travelPenalty = Math.max(
    0,
    actualStores.length - 1
  ) * visitCost;

  const estimatedTotal = productTotal + travelPenalty;

  return {
    stores: actualStores,
    storeLabels: actualStores.map(
      (retailer) => RETAILER_LABELS[retailer] || retailer
    ),
    assignments,
    groupedAssignments:
      groupAssignmentsByRetailer(assignments),
    unmatched,
    matchedItemCount: assignments.length,
    totalItemCount: matches.length,
    productTotal: roundMoney(productTotal),
    travelPenalty: roundMoney(travelPenalty),
    estimatedTotal: roundMoney(estimatedTotal),
    estimatedSaving: roundMoney(
      Math.max(0, referenceTotal - productTotal)
    ),
    coverage:
      matches.length > 0
        ? roundMoney(assignments.length / matches.length)
        : 0,
  };
}

function adjustedDealCost(candidate, preferredRetailers) {
  const preferenceBonus = preferredRetailers.includes(
    candidate.deal.r
  )
    ? 0.08
    : 0;

  const confidencePenalty =
    (1 - candidate.score) * 0.75;

  return (
    Number(candidate.deal.p || 0) +
    confidencePenalty -
    preferenceBonus
  );
}

function calculateMatchScore({
  itemTokens,
  dealTokens,
  itemName,
  dealName,
  itemCategory,
  dealCategory,
  itemEan,
  dealEan,
}) {
  if (itemEan && dealEan && String(itemEan) === String(dealEan)) {
    return 1;
  }

  const intersection = [...itemTokens]
    .filter((token) => dealTokens.has(token));

  const union = new Set([...itemTokens, ...dealTokens]);

  const jaccard = union.size
    ? intersection.length / union.size
    : 0;

  const queryCoverage = itemTokens.size
    ? intersection.length / itemTokens.size
    : 0;

  const normalizedItemName = normalizeText(itemName);
  const normalizedDealName = normalizeText(dealName);

  const phraseBonus =
    normalizedDealName.includes(normalizedItemName) ||
    normalizedItemName.includes(normalizedDealName)
      ? 0.2
      : 0;

  const categoryBonus =
    itemCategory &&
    dealCategory &&
    (
      itemCategory === dealCategory ||
      dealCategory.includes(itemCategory) ||
      itemCategory.includes(dealCategory)
    )
      ? 0.1
      : 0;

  return Math.min(
    1,
    jaccard * 0.35 +
    queryCoverage * 0.55 +
    phraseBonus +
    categoryBonus
  );
}

function normalizeShoppingItem(item) {
  if (typeof item === 'string') {
    return {
      id: crypto.randomUUID?.() || item,
      name: item.trim(),
      quantity: 1,
      unit: null,
      category: null,
      ean: null,
    };
  }

  return {
    id:
      item.id ||
      crypto.randomUUID?.() ||
      `${item.name}-${Math.random()}`,
    name: String(
      item.name ||
      item.product ||
      item.label ||
      ''
    ).trim(),
    quantity:
      Number(item.quantity ?? item.amount ?? 1) || 1,
    unit: item.unit || null,
    category: item.category || null,
    ean: item.ean || item.barcode || null,
  };
}

function tokenize(value) {
  return [...new Set(
    normalizeText(value)
      .split(/\s+/)
      .map((token) => SYNONYMS[token] || token)
      .filter(
        (token) =>
          token.length >= 2 &&
          !STOP_WORDS.has(token)
      )
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

function pairCombinations(values) {
  const pairs = [];

  for (let first = 0; first < values.length; first += 1) {
    for (
      let second = first + 1;
      second < values.length;
      second += 1
    ) {
      pairs.push([values[first], values[second]]);
    }
  }

  return pairs;
}

function groupAssignmentsByRetailer(assignments) {
  return Object.fromEntries(
    [...assignments.reduce((map, assignment) => {
      const current = map.get(assignment.retailer) || {
        retailer: assignment.retailer,
        retailerLabel: assignment.retailerLabel,
        items: [],
        subtotal: 0,
        savings: 0,
      };

      current.items.push(assignment);
      current.subtotal += assignment.lineTotal;
      current.savings += assignment.estimatedSaving;

      map.set(assignment.retailer, current);
      return map;
    }, new Map()).entries()].map(([key, group]) => [
      key,
      {
        ...group,
        subtotal: roundMoney(group.subtotal),
        savings: roundMoney(group.savings),
      },
    ])
  );
}

function comparePlans(a, b) {
  /*
   * Prefer broader coverage first. For similar coverage, choose the
   * lower estimated total including the configured extra-store cost.
   */
  const coverageDifference = b.coverage - a.coverage;

  if (Math.abs(coverageDifference) > 0.001) {
    return coverageDifference;
  }

  return (
    a.estimatedTotal - b.estimatedTotal ||
    a.stores.length - b.stores.length ||
    b.estimatedSaving - a.estimatedSaving
  );
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
