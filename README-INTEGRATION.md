# Voorraadmaat smart deals upgrade

Replace these files in the repository:

- `scripts/fetch-deals.mjs`
- `.github/workflows/refresh-deals.yml`

Add this new browser module:

- `site/js/deals-engine.js`

The workflow creates:

- `site/data/deals.json`: complete normalized deal records
- `site/data/deal-index.json`: compact index for fast matching on mobile

## Minimal integration

In the app module that creates the shopping list:

```js
import {
  loadDealIndex,
  optimizeShoppingList
} from './deals-engine.js';

const dealIndex = await loadDealIndex();

const result = optimizeShoppingList(shoppingList, dealIndex, {
  maxStores: 2,
  visitCost: 2.50,
  preferredRetailers: ['dirk', 'lidl']
});

console.log(result.bestSingleStore);
console.log(result.bestPlan);
console.log(result.savingsFromSecondStore);
```

`visitCost` is a practical penalty for visiting an additional supermarket.
Raise it when a second shop is inconvenient; lower it when the shops are
close together.

The engine returns grouped assignments under:

```js
result.bestPlan.groupedAssignments
```

Unmatched shopping-list products remain available under:

```js
result.bestPlan.unmatched
```
