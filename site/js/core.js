export const APP_STORAGE_KEY = 'voorraadmaat-state-v1';

export const STORE_LABELS = Object.freeze({
  albert_heijn: 'Albert Heijn',
  dirk: 'Dirk',
  lidl: 'Lidl',
  hoogvliet: 'Hoogvliet',
  plus: 'PLUS',
  unassigned: 'Geen aanbieding gevonden',
});

export const DEFAULT_SETTINGS = Object.freeze({
  householdSize: 2,
  recipesPerWeek: 5,
  selectedStores: ['albert_heijn', 'dirk', 'lidl', 'hoogvliet', 'plus'],
  includePantryStaples: false,
});

const HEADING_WORDS = new Set([
  'boodschappen',
  'boodschappenlijst',
  'boodschappen lijst',
  'grocery list',
  'nog halen',
  'gekocht',
  'weekboodschappen',
  'week boodschappen',
  'groente',
  'groenten',
  'fruit',
  'zuivel',
  'vlees',
  'vis',
  'overig',
]);

const UNIT_ALIASES = new Map([
  ['kg', ['kg', 'kilo', 'kilogram', 'kilogrammen']],
  ['g', ['g', 'gr', 'gram', 'grammen']],
  ['l', ['l', 'ltr', 'liter', 'liters']],
  ['cl', ['cl']],
  ['ml', ['ml', 'milliliter', 'milliliters']],
  ['st', [
    'st', 'stuk', 'stuks', 'x', 'pak', 'pakken', 'pakje', 'pakjes', 'blik', 'blikken',
    'pot', 'potten', 'zak', 'zakken', 'bak', 'bakken', 'bakje', 'bakjes', 'bos', 'bossen',
    'fles', 'flessen', 'doos', 'dozen', 'rol', 'rollen', 'net', 'netten', 'tray', 'trays',
  ]],
]);

const UNIT_LOOKUP = new Map();
for (const [unit, aliases] of UNIT_ALIASES.entries()) {
  for (const alias of aliases) UNIT_LOOKUP.set(alias, unit);
}

const UNIT_PATTERN = [...UNIT_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const PHRASE_ALIASES = [
  [/(?:cherry|snoep|roma)tomaten?/g, 'tomaat'],
  [/cherry tomaten?/g, 'tomaat'],
  [/snoep tomaten?/g, 'tomaat'],
  [/tomaten? uit blik/g, 'tomatenblokjes'],
  [/blik tomaten?/g, 'tomatenblokjes'],
  [/gepelde tomaten?/g, 'tomatenblokjes'],
  [/geraspte kaas/g, 'kaas'],
  [/(?:kipfilet|kipdijfilet|kipdij|kipreepjes)/g, 'kip'],
  [/(?:spaghetti|penne|fusilli|macaroni|tagliatelle)/g, 'pasta'],
  [/(?:wraps?|tortilla wraps?)/g, 'tortilla'],
  [/(?:zwarte bonen|black beans)/g, 'zwarte boon'],
  [/kidney bonen/g, 'kidneyboon'],
  [/(?:creme fraiche|crème fraîche)/g, 'creme fraiche'],
  [/(?:wokgroenten|roerbakgroenten|nasi groenten|nasigroenten|bami groenten|bamigroenten)/g, 'roerbakgroente'],
  [/(?:bosuitjes|lente ui|lente-uitjes)/g, 'bosui'],
  [/(?:knoflooktenen|tenen knoflook)/g, 'knoflook'],
  [/(?:olijfolie|zonnebloemolie|bakolie)/g, 'olie'],
];

const WORD_ALIASES = new Map([
  ['aardappelen', 'aardappel'],
  ['aardappels', 'aardappel'],
  ['tomaten', 'tomaat'],
  ['uien', 'ui'],
  ['eieren', 'ei'],
  ['paprikas', 'paprika'],
  ['bananen', 'banaan'],
  ['appels', 'appel'],
  ['peren', 'peer'],
  ['courgettes', 'courgette'],
  ['champignons', 'champignon'],
  ['wortelen', 'wortel'],
  ['wortels', 'wortel'],
  ['komkommers', 'komkommer'],
  ['avocados', 'avocado'],
  ['citroenen', 'citroen'],
  ['limoenen', 'limoen'],
  ['bonen', 'boon'],
  ['kidneybonen', 'kidneyboon'],
  ['linzen', 'linze'],
  ['erwten', 'erwt'],
  ['kikkererwten', 'kikkererwt'],
  ['tortillas', 'tortilla'],
  ['wrap', 'tortilla'],
  ['wraps', 'tortilla'],
  ['yogurt', 'yoghurt'],
  ['broccoliroosjes', 'broccoli'],
  ['bloemkolen', 'bloemkool'],
  ['bosuien', 'bosui'],
  ['lenteuitjes', 'bosui'],
  ['blikjes', 'blik'],
  ['pakken', 'pak'],
]);

const CATEGORY_RULES = [
  ['Groente & fruit', ['aardappel', 'tomaat', 'ui', 'paprika', 'banaan', 'appel', 'peer', 'courgette', 'champignon', 'wortel', 'komkommer', 'avocado', 'citroen', 'limoen', 'broccoli', 'bloemkool', 'spinazie', 'sla', 'prei', 'bosui', 'knoflook', 'aubergine', 'mango', 'druif']],
  ['Zuivel & eieren', ['melk', 'yoghurt', 'kwark', 'kaas', 'ei', 'boter', 'room', 'creme fraiche', 'feta', 'mozzarella']],
  ['Vlees, vis & vega', ['kip', 'gehakt', 'rund', 'varken', 'zalm', 'tonijn', 'vis', 'tofu', 'tempeh', 'vega', 'worst']],
  ['Brood & ontbijt', ['brood', 'bol', 'cracker', 'muesli', 'havermout', 'cornflakes', 'beleg']],
  ['Pasta, rijst & wereldkeuken', ['pasta', 'rijst', 'couscous', 'noedel', 'tortilla', 'naan', 'quinoa']],
  ['Blik, pot & sauzen', ['tomatenblokjes', 'kikkererwt', 'kidneyboon', 'zwarte boon', 'mais', 'kokosmelk', 'pesto', 'saus', 'bouillon', 'linze']],
  ['Dranken', ['koffie', 'thee', 'water', 'sap', 'cola', 'limonade', 'bier', 'wijn']],
  ['Huishouden', ['toiletpapier', 'keukenpapier', 'afwas', 'wasmiddel', 'vuilniszak', 'schoonmaak']],
];

export function createId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function stripDiacritics(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeText(value = '') {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function canonicalProductName(value = '') {
  let normalized = normalizeText(value)
    .replace(/\b(?:bio|biologisch|vers|verse|diepvries|bevroren|groot|klein|medium|los|naturel)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|cl|l|liter|st|stuks?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((word) => WORD_ALIASES.get(word) ?? word)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function categorizeProduct(name = '') {
  const key = canonicalProductName(name);
  for (const [category, words] of CATEGORY_RULES) {
    if (words.some((word) => key.includes(word))) return category;
  }
  return 'Overig';
}

export function parseGroceryText(text = '') {
  const normalizedInput = String(text)
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();

  if (!normalizedInput) return [];

  let lines = normalizedInput.split('\n');
  if (lines.length === 1 && normalizedInput.includes(';')) {
    lines = normalizedInput.split(';');
  }

  const parsed = [];

  for (const originalLine of lines) {
    let line = originalLine
      .replace(/^\s*(?:[-*•·▪◦]|\d+[.)])\s*/, '')
      .replace(/^\s*(?:\[[ xX✓✔]\]|☐|☑|✅|✓|✔)\s*/, '')
      .replace(/\s+#.*$/, '')
      .replace(/\s+€\s*\d+(?:[.,]\d{1,2})?\s*$/, '')
      .trim();

    if (!line) continue;

    const heading = normalizeText(line.replace(/:$/, ''));
    if ((line.endsWith(':') || HEADING_WORDS.has(heading)) && heading.length < 32) continue;

    const item = parseGroceryLine(line);
    if (!item || !item.name || item.quantity <= 0) continue;
    parsed.push(item);
  }

  return mergeParsedDuplicates(parsed);
}

export function parseGroceryLine(line) {
  let name = line.trim();
  let quantity = 1;
  let unit = 'st';

  const multiplierMeasure = name.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})\\b\\s+(.+)$`, 'i'));
  if (multiplierMeasure) {
    const count = parseNumber(multiplierMeasure[1]);
    const measure = parseNumber(multiplierMeasure[2]);
    const converted = normalizeQuantity(count * measure, multiplierMeasure[3]);
    quantity = converted.quantity;
    unit = converted.unit;
    name = multiplierMeasure[4];
    return buildParsedItem(name, quantity, unit, line);
  }

  const prefixMultiplier = name.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s+(.+)$/i);
  if (prefixMultiplier) {
    quantity = parseNumber(prefixMultiplier[1]);
    unit = 'st';
    name = prefixMultiplier[2];
    return buildParsedItem(name, quantity, unit, line);
  }

  const prefixMeasure = name.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})\\b\\s*(?:van\\s+)?(.+)$`, 'i'));
  if (prefixMeasure) {
    const converted = normalizeQuantity(parseNumber(prefixMeasure[1]), prefixMeasure[2]);
    quantity = converted.quantity;
    unit = converted.unit;
    name = prefixMeasure[3];
    return buildParsedItem(name, quantity, unit, line);
  }

  const trailingMeasure = name.match(new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})\\b$`, 'i'));
  if (trailingMeasure) {
    const converted = normalizeQuantity(parseNumber(trailingMeasure[2]), trailingMeasure[3]);
    quantity = converted.quantity;
    unit = converted.unit;
    name = trailingMeasure[1];
    return buildParsedItem(name, quantity, unit, line);
  }

  const trailingMultiplier = name.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*[x×]$/i);
  if (trailingMultiplier) {
    quantity = parseNumber(trailingMultiplier[2]);
    unit = 'st';
    name = trailingMultiplier[1];
    return buildParsedItem(name, quantity, unit, line);
  }

  const prefixNumber = name.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (prefixNumber) {
    quantity = parseNumber(prefixNumber[1]);
    unit = 'st';
    name = prefixNumber[2];
    return buildParsedItem(name, quantity, unit, line);
  }

  const trailingNumber = name.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);
  if (trailingNumber && !/\b(?:vitamine|zero|0)\b/i.test(name)) {
    quantity = parseNumber(trailingNumber[2]);
    unit = 'st';
    name = trailingNumber[1];
  }

  return buildParsedItem(name, quantity, unit, line);
}

function buildParsedItem(name, quantity, unit, raw) {
  const cleanedName = String(name)
    .replace(/^[-,:;\s]+|[-,:;\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const key = canonicalProductName(cleanedName);
  if (!key || !Number.isFinite(quantity)) return null;
  return {
    name: cleanedName,
    key,
    quantity: roundQuantity(quantity),
    unit,
    category: categorizeProduct(cleanedName),
    raw,
  };
}

function mergeParsedDuplicates(items) {
  const result = [];
  for (const item of items) {
    const existing = result.find((candidate) => candidate.key === item.key && candidate.unit === item.unit);
    if (existing) {
      existing.quantity = roundQuantity(existing.quantity + item.quantity);
    } else {
      result.push({ ...item });
    }
  }
  return result;
}

function parseNumber(value) {
  return Number(String(value).replace(',', '.'));
}

function normalizeQuantity(quantity, inputUnit) {
  const lookup = UNIT_LOOKUP.get(normalizeText(inputUnit)) ?? normalizeText(inputUnit);
  if (lookup === 'kg') return { quantity: quantity * 1000, unit: 'g' };
  if (lookup === 'l') return { quantity: quantity * 1000, unit: 'ml' };
  if (lookup === 'cl') return { quantity: quantity * 10, unit: 'ml' };
  if (lookup === 'g' || lookup === 'ml') return { quantity, unit: lookup };
  return { quantity, unit: 'st' };
}

export function addItemsToInventory(inventory = [], parsedItems = [], source = 'handmatig') {
  const next = inventory.map((item) => ({ ...item }));
  const now = new Date().toISOString();

  for (const parsedItem of parsedItems) {
    const key = parsedItem.key || canonicalProductName(parsedItem.name);
    const existing = next.find((item) => item.key === key && item.unit === parsedItem.unit);
    if (existing) {
      existing.quantity = roundQuantity(Number(existing.quantity) + Number(parsedItem.quantity));
      existing.updatedAt = now;
      existing.source = source;
    } else {
      next.push({
        id: createId('inv'),
        name: parsedItem.name,
        key,
        quantity: roundQuantity(Number(parsedItem.quantity)),
        unit: parsedItem.unit || 'st',
        category: parsedItem.category || categorizeProduct(parsedItem.name),
        source,
        addedAt: now,
        updatedAt: now,
      });
    }
  }

  return next.filter((item) => item.quantity > 0);
}

export function productMatches(productNameOrKey, ingredientNameOrKey) {
  const product = canonicalProductName(productNameOrKey);
  const ingredient = canonicalProductName(ingredientNameOrKey);
  if (!product || !ingredient) return false;
  if (product === ingredient) return true;
  if (Math.min(product.length, ingredient.length) >= 4 && (product.includes(ingredient) || ingredient.includes(product))) return true;

  const productTokens = new Set(product.split(' ').filter((token) => token.length >= 3));
  const ingredientTokens = ingredient.split(' ').filter((token) => token.length >= 3);
  if (!ingredientTokens.length) return false;
  const overlap = ingredientTokens.filter((token) => productTokens.has(token)).length;
  return overlap / ingredientTokens.length >= 0.67;
}

export function getAvailableQuantity(inventory = [], ingredient) {
  const ingredientKey = ingredient.key || canonicalProductName(ingredient.name);
  return inventory
    .filter((item) => item.unit === ingredient.unit && productMatches(item.key || item.name, ingredientKey))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export function scaledIngredients(recipe, householdSize = 2, includePantryStaples = false) {
  const servings = Number(recipe.servings || 2);
  const scale = Math.max(0.25, Number(householdSize || 2) / servings);
  return recipe.ingredients
    .filter((ingredient) => includePantryStaples || !ingredient.pantry)
    .map((ingredient) => ({
      ...ingredient,
      key: ingredient.key || canonicalProductName(ingredient.name),
      quantity: roundQuantity(Number(ingredient.quantity) * scale),
    }));
}

export function missingForRecipe(recipe, inventory = [], settings = DEFAULT_SETTINGS) {
  return scaledIngredients(recipe, settings.householdSize, settings.includePantryStaples)
    .map((ingredient) => {
      const available = getAvailableQuantity(inventory, ingredient);
      return {
        ...ingredient,
        available,
        missing: roundQuantity(Math.max(0, ingredient.quantity - available)),
        coverage: ingredient.quantity > 0 ? Math.min(1, available / ingredient.quantity) : 1,
      };
    });
}

export function rankRecipes(recipes = [], inventory = [], settings = DEFAULT_SETTINGS) {
  return recipes
    .map((recipe) => {
      const ingredients = missingForRecipe(recipe, inventory, settings);
      const total = Math.max(1, ingredients.length);
      const coverage = ingredients.reduce((sum, ingredient) => sum + ingredient.coverage, 0) / total;
      const missingCount = ingredients.filter((ingredient) => ingredient.missing > 0.0001).length;
      const freshMatches = ingredients.filter((ingredient) => ingredient.coverage > 0 && isFreshIngredient(ingredient.key)).length;
      const completeBonus = missingCount === 0 ? 25 : 0;
      const score = coverage * 100 - missingCount * 8 + freshMatches * 2 + completeBonus - Number(recipe.difficulty || 1);
      return {
        recipe,
        score,
        coverage,
        missingCount,
        ingredients,
      };
    })
    .sort((a, b) => b.score - a.score || a.missingCount - b.missingCount || a.recipe.title.localeCompare(b.recipe.title, 'nl'));
}

export function proposeWeek(recipes = [], inventory = [], settings = DEFAULT_SETTINGS, excludedIds = []) {
  const target = Math.max(1, Math.min(7, Number(settings.recipesPerWeek || 5)));
  const selected = [];
  let virtualInventory = inventory.map((item) => ({ ...item }));
  const excluded = new Set(excludedIds);

  while (selected.length < target) {
    const ranked = rankRecipes(
      recipes.filter((recipe) => !excluded.has(recipe.id) && !selected.includes(recipe.id)),
      virtualInventory,
      settings,
    );
    if (!ranked.length) break;

    const pick = ranked[0];
    selected.push(pick.recipe.id);
    virtualInventory = deductIngredients(
      virtualInventory,
      scaledIngredients(pick.recipe, settings.householdSize, settings.includePantryStaples),
    ).inventory;
  }

  return selected;
}

export function consumeRecipe(recipe, inventory = [], settings = DEFAULT_SETTINGS) {
  const ingredients = scaledIngredients(recipe, settings.householdSize, settings.includePantryStaples);
  return deductIngredients(inventory, ingredients);
}

export function deductIngredients(inventory = [], ingredients = []) {
  const next = inventory.map((item) => ({ ...item }));
  const deductions = [];
  const shortages = [];

  for (const ingredient of ingredients) {
    let remaining = Number(ingredient.quantity || 0);
    const matches = next
      .filter((item) => item.unit === ingredient.unit && productMatches(item.key || item.name, ingredient.key || ingredient.name))
      .sort((a, b) => {
        const aExact = canonicalProductName(a.key || a.name) === canonicalProductName(ingredient.key || ingredient.name) ? 1 : 0;
        const bExact = canonicalProductName(b.key || b.name) === canonicalProductName(ingredient.key || ingredient.name) ? 1 : 0;
        return bExact - aExact || new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
      });

    for (const item of matches) {
      if (remaining <= 0.0001) break;
      const used = Math.min(Number(item.quantity), remaining);
      item.quantity = roundQuantity(Number(item.quantity) - used);
      remaining = roundQuantity(remaining - used);
      deductions.push({
        inventoryId: item.id,
        name: item.name,
        quantity: used,
        unit: item.unit,
      });
    }

    if (remaining > 0.0001) {
      shortages.push({ ...ingredient, missing: remaining });
    }
  }

  return {
    inventory: next.filter((item) => item.quantity > 0.0001),
    deductions,
    shortages,
  };
}

export function buildShoppingListFromPlan(plannedRecipeIds = [], recipes = [], inventory = [], settings = DEFAULT_SETTINGS) {
  const recipeMap = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const needs = new Map();

  for (const recipeId of plannedRecipeIds) {
    const recipe = recipeMap.get(recipeId);
    if (!recipe) continue;
    for (const ingredient of scaledIngredients(recipe, settings.householdSize, settings.includePantryStaples)) {
      const bucketKey = `${ingredient.key}|${ingredient.unit}`;
      const existing = needs.get(bucketKey) ?? {
        id: createId('shop'),
        name: ingredient.name,
        key: ingredient.key,
        quantity: 0,
        unit: ingredient.unit,
        recipeIds: [],
        source: 'weekmenu',
        checked: false,
      };
      existing.quantity = roundQuantity(existing.quantity + ingredient.quantity);
      if (!existing.recipeIds.includes(recipeId)) existing.recipeIds.push(recipeId);
      needs.set(bucketKey, existing);
    }
  }

  const shopping = [];
  for (const need of needs.values()) {
    const available = getAvailableQuantity(inventory, need);
    const missing = roundQuantity(Math.max(0, need.quantity - available));
    if (missing > 0.0001) shopping.push({ ...need, quantity: missing });
  }

  return shopping.sort((a, b) => categorizeProduct(a.name).localeCompare(categorizeProduct(b.name), 'nl') || a.name.localeCompare(b.name, 'nl'));
}

export function mergeShoppingLists(existing = [], generated = []) {
  const manual = existing.filter((item) => item.source !== 'weekmenu');
  return [...manual, ...generated];
}

export function normalizeDeal(raw = {}) {
  const retailer = normalizeRetailer(raw.retailer || raw.store || raw.supermarket || raw.retailer_slug || raw.retailerSlug);
  const name = raw.name || raw.title || raw.product_name || raw.productName || raw.description || 'Onbekend product';
  const price = numberOrNull(raw.price ?? raw.current_price ?? raw.currentPrice ?? raw.offer_price ?? raw.offerPrice);
  const originalPrice = numberOrNull(raw.original_price ?? raw.originalPrice ?? raw.regular_price ?? raw.regularPrice ?? raw.was_price ?? raw.wasPrice);
  const validFrom = raw.valid_from || raw.validFrom || raw.start_date || raw.startDate || null;
  const validUntil = raw.valid_until || raw.validUntil || raw.end_date || raw.endDate || null;

  return {
    id: String(raw.id || raw.product_id || raw.productId || `${retailer}-${canonicalProductName(name)}-${price ?? 'x'}`),
    retailer,
    name: String(name),
    key: canonicalProductName(name),
    price,
    originalPrice,
    discountPercentage: numberOrNull(raw.discount_percentage ?? raw.discountPercentage ?? raw.discount),
    unitPrice: raw.unit_price || raw.unitPrice || null,
    quantity: raw.quantity || raw.package_size || raw.packageSize || null,
    category: raw.category || raw.category_name || raw.categoryName || null,
    promotionType: raw.promotion_type || raw.promotionType || raw.offer_text || raw.offerText || null,
    promotionStatus: raw.promotion_status || raw.promotionStatus || null,
    validFrom,
    validUntil,
    url: raw.url || raw.product_url || raw.productUrl || null,
    imageUrl: raw.image_url || raw.imageUrl || raw.image || null,
  };
}

export function normalizeRetailer(value = '') {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (['ah', 'albert_heijn', 'albert-heijn'].includes(normalized)) return 'albert_heijn';
  if (normalized.includes('albert') && normalized.includes('heijn')) return 'albert_heijn';
  if (normalized.includes('hoogvliet')) return 'hoogvliet';
  if (normalized.includes('dirk')) return 'dirk';
  if (normalized.includes('lidl')) return 'lidl';
  if (normalized.includes('plus')) return 'plus';
  return normalized;
}

export function isDealActive(deal, at = new Date()) {
  if (!deal || deal.price == null) return false;
  if (deal.promotionStatus && ['historical', 'expired', 'inactive'].includes(normalizeText(deal.promotionStatus))) return false;
  const day = new Date(at);
  day.setHours(12, 0, 0, 0);
  if (deal.validFrom) {
    const start = parseDealDate(deal.validFrom, false);
    if (start && day < start) return false;
  }
  if (deal.validUntil) {
    const end = parseDealDate(deal.validUntil, true);
    if (end && day > end) return false;
  }
  return true;
}

export function dealMatchScore(shoppingItem, deal) {
  const itemKey = canonicalProductName(shoppingItem.key || shoppingItem.name);
  const dealKey = canonicalProductName(deal.key || deal.name);
  if (!itemKey || !dealKey) return 0;
  if (itemKey === dealKey) return 100;
  if (dealKey.includes(itemKey)) return 85;
  if (itemKey.includes(dealKey) && dealKey.length >= 4) return 78;

  const itemTokens = itemKey.split(' ').filter((token) => token.length >= 3);
  const dealTokens = new Set(dealKey.split(' ').filter((token) => token.length >= 3));
  const overlap = itemTokens.filter((token) => dealTokens.has(token)).length;
  if (!itemTokens.length || overlap === 0) return 0;
  const ratio = overlap / itemTokens.length;
  return ratio >= 0.67 ? 55 + ratio * 20 : 0;
}

export function routeShoppingList(shopping = [], deals = [], selectedStores = DEFAULT_SETTINGS.selectedStores, at = new Date()) {
  const allowedStores = new Set(selectedStores);
  const activeDeals = deals
    .map((deal) => (deal.key ? deal : normalizeDeal(deal)))
    .filter((deal) => allowedStores.has(deal.retailer) && isDealActive(deal, at));

  const groups = Object.fromEntries([...selectedStores, 'unassigned'].map((store) => [store, []]));

  for (const item of shopping.filter((candidate) => !candidate.checked)) {
    const candidates = activeDeals
      .map((deal) => ({ deal, score: dealMatchScore(item, deal) }))
      .filter((candidate) => candidate.score >= 60 && candidate.deal.price != null)
      .sort((a, b) => Number(a.deal.price) - Number(b.deal.price) || b.score - a.score);

    const best = candidates[0] ?? null;
    const routed = {
      ...item,
      assignedStore: best?.deal.retailer ?? 'unassigned',
      bestDeal: best?.deal ?? null,
      alternatives: candidates.slice(1, 4).map((candidate) => candidate.deal),
    };
    groups[routed.assignedStore] ??= [];
    groups[routed.assignedStore].push(routed);
  }

  return groups;
}

export function sanitizeState(raw = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(raw.settings || {}),
  };
  settings.householdSize = clampNumber(settings.householdSize, 1, 12, DEFAULT_SETTINGS.householdSize);
  settings.recipesPerWeek = clampNumber(settings.recipesPerWeek, 1, 7, DEFAULT_SETTINGS.recipesPerWeek);
  settings.selectedStores = Array.isArray(settings.selectedStores)
    ? settings.selectedStores.map(normalizeRetailer).filter((store) => STORE_LABELS[store])
    : [...DEFAULT_SETTINGS.selectedStores];
  if (!settings.selectedStores.length) settings.selectedStores = [...DEFAULT_SETTINGS.selectedStores];

  return {
    version: 1,
    inventory: Array.isArray(raw.inventory)
      ? raw.inventory
          .map((item) => ({
            ...item,
            id: item.id || createId('inv'),
            name: String(item.name || 'Onbekend product'),
            key: item.key || canonicalProductName(item.name),
            quantity: Number(item.quantity || 0),
            unit: ['g', 'ml', 'st'].includes(item.unit) ? item.unit : 'st',
            category: item.category || categorizeProduct(item.name),
          }))
          .filter((item) => item.quantity > 0)
      : [],
    shopping: Array.isArray(raw.shopping)
      ? raw.shopping.map((item) => ({
          ...item,
          id: item.id || createId('shop'),
          key: item.key || canonicalProductName(item.name),
          quantity: Number(item.quantity || 1),
          unit: ['g', 'ml', 'st'].includes(item.unit) ? item.unit : 'st',
          checked: Boolean(item.checked),
          source: item.source || 'handmatig',
        }))
      : [],
    plannedRecipes: Array.isArray(raw.plannedRecipes) ? [...new Set(raw.plannedRecipes.map(String))] : [],
    completedRecipes: Array.isArray(raw.completedRecipes) ? raw.completedRecipes : [],
    activity: Array.isArray(raw.activity) ? raw.activity.slice(0, 100) : [],
    settings,
  };
}

export function formatQuantity(quantity, unit = 'st') {
  const value = Number(quantity || 0);
  if (unit === 'g' && value >= 1000) return `${formatNumber(value / 1000)} kg`;
  if (unit === 'ml' && value >= 1000) return `${formatNumber(value / 1000)} l`;
  return `${formatNumber(value)} ${unit}`;
}

export function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '–';
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value.includes?.('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(roundQuantity(value));
}

function isFreshIngredient(key = '') {
  return ['aardappel', 'tomaat', 'ui', 'paprika', 'courgette', 'champignon', 'wortel', 'komkommer', 'avocado', 'broccoli', 'bloemkool', 'spinazie', 'sla', 'prei', 'kip', 'zalm', 'gehakt', 'melk', 'yoghurt', 'kaas', 'ei'].some((word) => key.includes(word));
}

function parseDealDate(value, endOfDay) {
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T${endOfDay ? '23:59:59' : '00:00:00'}`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && !/^\d{4}-\d{2}-\d{2}$/.test(text)) date.setHours(23, 59, 59, 999);
  return date;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
