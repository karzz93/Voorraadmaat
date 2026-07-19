import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addItemsToInventory,
  buildShoppingListFromPlan,
  canonicalProductName,
  consumeRecipe,
  parseGroceryText,
  rankRecipes,
  routeShoppingList,
  sanitizeState,
} from '../site/js/core.js';
import { RECIPE_LIBRARY } from '../site/js/recipes.js';

test('parses common Samsung Notes grocery formats', () => {
  const parsed = parseGroceryText(`
    Boodschappenlijst:
    ☐ 2x melk
    - 1,5 kg aardappelen
    • bananen 6
    [x] 2 x 500 g yoghurt
    2 pakken tomatenblokjes
  `);

  assert.equal(parsed.length, 5);
  assert.deepEqual(pick(parsed, 'melk'), { quantity: 2, unit: 'st' });
  assert.deepEqual(pick(parsed, 'aardappel'), { quantity: 1500, unit: 'g' });
  assert.deepEqual(pick(parsed, 'banaan'), { quantity: 6, unit: 'st' });
  assert.deepEqual(pick(parsed, 'yoghurt'), { quantity: 1000, unit: 'g' });
  assert.deepEqual(pick(parsed, 'tomatenblokjes'), { quantity: 2, unit: 'st' });
});

test('merges duplicate inventory entries with matching base units', () => {
  const parsed = parseGroceryText('1 kg aardappelen\n500 g aardappels\n2 melk\n1 melk');
  const inventory = addItemsToInventory([], parsed, 'test');
  const potatoes = inventory.find((item) => item.key === 'aardappel');
  const milk = inventory.find((item) => item.key === 'melk');

  assert.equal(potatoes.quantity, 1500);
  assert.equal(potatoes.unit, 'g');
  assert.equal(milk.quantity, 3);
  assert.equal(milk.unit, 'st');
});

test('canonical names handle useful Dutch synonyms', () => {
  assert.equal(canonicalProductName('Verse kipfilet 500 g'), 'kip');
  assert.equal(canonicalProductName('Spaghetti'), 'pasta');
  assert.equal(canonicalProductName("Paprika's"), 'paprika');
  assert.equal(canonicalProductName('Wraps'), 'tortilla');
});

test('recipe ranking rewards recipes covered by inventory', () => {
  const inventory = addItemsToInventory([], parseGroceryText(`
    320 g pasta
    2 tomatenblokjes
    1 ui
    2 knoflook
    100 g kaas
  `), 'test');
  const ranked = rankRecipes(RECIPE_LIBRARY, inventory, { householdSize: 4, recipesPerWeek: 5, selectedStores: [], includePantryStaples: false });

  assert.equal(ranked[0].recipe.id, 'pasta-tomatensaus');
  assert.equal(ranked[0].missingCount, 0);
});

test('consuming a recipe deducts available quantities and reports shortages', () => {
  const recipe = RECIPE_LIBRARY.find((item) => item.id === 'pasta-tomatensaus');
  const inventory = addItemsToInventory([], parseGroceryText(`
    500 g pasta
    2 tomatenblokjes
    1 ui
    2 knoflook
    50 g kaas
  `), 'test');
  const result = consumeRecipe(recipe, inventory, { householdSize: 4, includePantryStaples: false });

  const pasta = result.inventory.find((item) => item.key === 'pasta');
  assert.equal(pasta.quantity, 180);
  assert.equal(result.inventory.some((item) => item.key === 'ui'), false);
  assert.equal(result.shortages.length, 1);
  assert.equal(result.shortages[0].key, 'kaas');
  assert.equal(result.shortages[0].missing, 50);
});

test('shopping list contains only missing planned ingredients', () => {
  const inventory = addItemsToInventory([], parseGroceryText('320 g pasta\n2 tomatenblokjes'), 'test');
  const shopping = buildShoppingListFromPlan(
    ['pasta-tomatensaus'],
    RECIPE_LIBRARY,
    inventory,
    { householdSize: 4, includePantryStaples: false },
  );

  assert.equal(shopping.some((item) => item.key === 'pasta'), false);
  assert.equal(shopping.some((item) => item.key === 'tomatenblokjes'), false);
  assert.equal(shopping.some((item) => item.key === 'ui'), true);
  assert.equal(shopping.some((item) => item.key === 'kaas'), true);
});

test('shopping routing selects the cheapest matching active deal', () => {
  const shopping = [{ id: 's1', name: 'pasta', key: 'pasta', quantity: 1, unit: 'st', checked: false }];
  const deals = [
    { id: 'd1', retailer: 'plus', name: 'PLUS penne pasta', price: 1.49, validFrom: '2026-07-01', validUntil: '2026-07-31' },
    { id: 'd2', retailer: 'dirk', name: 'Spaghetti pasta', price: 0.99, validFrom: '2026-07-01', validUntil: '2026-07-31' },
  ];
  const groups = routeShoppingList(shopping, deals, ['plus', 'dirk'], new Date('2026-07-18T12:00:00'));

  assert.equal(groups.dirk.length, 1);
  assert.equal(groups.dirk[0].bestDeal.id, 'd2');
  assert.equal(groups.plus.length, 0);
});

test('state sanitization restores safe defaults', () => {
  const state = sanitizeState({ settings: { householdSize: 99, selectedStores: [] }, inventory: [{ name: 'Melk', quantity: 2, unit: 'weird' }] });
  assert.equal(state.settings.householdSize, 12);
  assert.equal(state.settings.selectedStores.length > 0, true);
  assert.equal(state.inventory[0].unit, 'st');
});

function pick(items, key) {
  const item = items.find((candidate) => candidate.key === key);
  assert.ok(item, `Expected item with key ${key}`);
  return { quantity: item.quantity, unit: item.unit };
}
