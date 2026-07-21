import {
  APP_STORAGE_KEY,
  DEFAULT_SETTINGS,
  STORE_LABELS,
  addItemsToInventory,
  buildShoppingListFromPlan,
  canonicalProductName,
  categorizeProduct,
  consumeRecipe,
  createId,
  formatCurrency,
  formatDate,
  formatQuantity,
  isDealActive,
  mergeShoppingLists,
  missingForRecipe,
  normalizeDeal,
  parseGroceryText,
  proposeWeek,
  rankRecipes,
  routeShoppingList,
  sanitizeState,
  scaledIngredients,
} from './core.js';
import { RECIPE_LIBRARY } from './recipes.js';
import {
  DEAL_CATEGORIES,
  clearDealsCache,
  loadTopDeals,
} from './deals-api.js';
import { optimizeShoppingList } from './deals-engine.js';
import { extractSamsungNoteText } from './samsung-notes.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toastRegion = document.querySelector('#toast-region');
const connectionStatus = document.querySelector('#connection-status');
const recipeMap = new Map(RECIPE_LIBRARY.map((recipe) => [recipe.id, recipe]));

let state = loadState();
let currentView = sessionStorage.getItem('voorraadmaat-view') || 'home';
let deals = [];
let dealsMeta = { status: 'idle' };
let dealOptimization = null;
let installPrompt = null;
let undoSnapshot = null;
let toastTimer = null;

const ui = {
  inventorySearch: '',
  dealSearch: '',
  dealStore: 'all',
  dealCategory: 'all',
};

init();

async function init() {
  bindEvents();
  updateConnectionStatus();
  render();
  registerServiceWorker();
  handleShareTarget();
  await loadDeals();
}

function bindEvents() {
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  document.addEventListener('submit', handleSubmit);
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    showToast('Voorraadmaat kan als app worden geïnstalleerd.');
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showToast('Voorraadmaat is geïnstalleerd.');
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close();
  });
}

function handleClick(event) {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    navigate(nav.dataset.nav);
    return;
  }

  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case 'open-import':
      openImportDialog(target.dataset.text || '');
      break;
    case 'open-add-inventory':
      openAddInventoryDialog();
      break;
    case 'open-add-shopping':
      openAddShoppingDialog();
      break;
    case 'open-settings':
      openSettingsDialog();
      break;
    case 'close-modal':
      modal.close();
      break;
    case 'install':
      installApp();
      break;
    case 'propose-week':
      createWeekProposal();
      break;
    case 'generate-shopping':
      generateShoppingList(true);
      break;
    case 'plan-recipe':
      toggleRecipePlan(id, true);
      break;
    case 'unplan-recipe':
      toggleRecipePlan(id, false);
      break;
    case 'view-recipe':
      openRecipeDialog(id);
      break;
    case 'adjust-inventory':
      adjustInventory(id, Number(target.dataset.direction || 0));
      break;
    case 'delete-shopping':
      removeShoppingItem(id);
      break;
    case 'add-deal-to-shopping':
      addDealToShopping(id);
      break;
    case 'share-shopping':
      shareShoppingList();
      break;
    case 'refresh-deals':
      clearDealsCache();
      resetDealFeed();
      loadDeals({ announce: true, force: true });
      break;
    case 'set-deal-store':
      ui.dealStore = target.dataset.store || 'all';
      render();
      break;
    case 'set-deal-category':
      ui.dealCategory = target.dataset.category || 'all';
      render();
      break;
    case 'export-backup':
      exportBackup();
      break;
    case 'trigger-backup-import':
      document.querySelector('#backup-import')?.click();
      break;
    case 'reset-data':
      resetData();
      break;
    case 'undo':
      restoreUndo();
      break;
    default:
      break;
  }
}

function handleChange(event) {
  const target = event.target;
  const action = target.dataset.action;

  if (target.id === 'import-file') {
    readGroceryFile(target.files?.[0]);
    return;
  }
  if (target.id === 'backup-import') {
    importBackup(target.files?.[0]);
    return;
  }

  if (!action) return;

  if (action === 'consume-product' && target.checked) {
    consumeInventoryItem(target.dataset.id);
  }
  if (action === 'cook-recipe' && target.checked) {
    markRecipeCooked(target.dataset.id);
  }
  if (action === 'buy-shopping' && target.checked) {
    markShoppingBought(target.dataset.id);
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.id === 'import-text') {
    renderImportPreview(target.value);
    return;
  }
  if (target.id === 'inventory-search') {
    ui.inventorySearch = target.value;
    filterInventoryRows(target.value);
    return;
  }
  if (target.id === 'deal-search') {
    ui.dealSearch = target.value;
    filterDealCards(target.value);
  }
}

function handleSubmit(event) {
  const form = event.target;
  event.preventDefault();

  if (form.id === 'import-form') submitGroceryImport(form);
  if (form.id === 'inventory-form') submitInventoryItem(form);
  if (form.id === 'shopping-form') submitShoppingItem(form);
  if (form.id === 'settings-form') submitSettings(form);
}

function navigate(view) {
  if (!['home', 'inventory', 'week', 'shopping', 'deals'].includes(view)) view = 'home';
  currentView = view;
  sessionStorage.setItem('voorraadmaat-view', view);
  render();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  const renderers = {
    home: renderHome,
    inventory: renderInventory,
    week: renderWeek,
    shopping: renderShopping,
    deals: renderDeals,
  };
  app.innerHTML = (renderers[currentView] || renderHome)();
  document.querySelectorAll('.bottom-nav [data-nav]').forEach((button) => {
    if (button.dataset.nav === currentView) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function renderHome() {
  const ranked = rankRecipes(RECIPE_LIBRARY, state.inventory, state.settings).slice(0, 3);
  const activeShopping = state.shopping.filter((item) => !item.checked).length;
  const distinctInventory = state.inventory.length;
  const totalUnits = state.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const hero = distinctInventory
    ? `
      <section class="hero">
        <span class="eyebrow">Klaar voor deze week</span>
        <h1>Kook eerst met wat er al in huis is.</h1>
        <p>Je voorraad bevat ${distinctInventory} verschillende producten. Laat Voorraadmaat daar een weekmenu en winkellijst van maken.</p>
        <div class="hero-actions">
          <button class="button lime" type="button" data-action="propose-week">Maak weekvoorstel</button>
          <button class="button ghost" type="button" data-action="open-import">Importeer boodschappen</button>
        </div>
      </section>`
    : `
      <section class="hero">
        <span class="eyebrow">Begin met je boodschappen</span>
        <h1>Deel je Samsung Notes-lijst met Voorraadmaat.</h1>
        <p>Plak tekst, upload een tekstbestand of deel een notitie rechtstreeks nadat de app op Android is geïnstalleerd.</p>
        <div class="hero-actions">
          <button class="button lime" type="button" data-action="open-import">Boodschappen importeren</button>
          <button class="button ghost" type="button" data-action="open-add-inventory">Product handmatig toevoegen</button>
        </div>
      </section>`;

  return `
    <div class="page">
      ${hero}

      <section class="stats-grid" aria-label="Samenvatting">
        <div class="stat-card"><strong>${distinctInventory}</strong><span>producten</span></div>
        <div class="stat-card"><strong>${state.plannedRecipes.length}</strong><span>recepten gepland</span></div>
        <div class="stat-card"><strong>${activeShopping}</strong><span>nog kopen</span></div>
      </section>

      <section class="card">
        <div class="card-header">
          <div><span class="eyebrow">Snel doen</span><h2>Van notitie naar avondeten</h2></div>
        </div>
        <div class="quick-grid">
          <button class="quick-action" type="button" data-action="open-import"><span>↥</span><span><strong>Importeren</strong><small>Plak of deel een lijst</small></span></button>
          <button class="quick-action" type="button" data-action="open-add-inventory"><span>＋</span><span><strong>Product</strong><small>Handmatig toevoegen</small></span></button>
          <button class="quick-action" type="button" data-action="propose-week"><span>♨</span><span><strong>Weekmenu</strong><small>${state.settings.recipesPerWeek} slimme recepten</small></span></button>
          <button class="quick-action" type="button" data-nav="shopping"><span>✓</span><span><strong>Winkellijst</strong><small>Gegroepeerd per winkel</small></span></button>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div><span class="eyebrow">Beste matches</span><h2>Dit kun je bijna maken</h2><p>Gebaseerd op je huidige voorraad voor ${state.settings.householdSize} personen.</p></div>
          <button class="text-button" type="button" data-nav="week">Alles bekijken</button>
        </div>
        ${ranked.length ? `<div class="recipe-list two-column">${ranked.map((entry) => recipeSuggestionCard(entry)).join('')}</div>` : emptyState('🥕', 'Nog geen receptmatches', 'Importeer eerst je gekochte producten om recepten te laten voorstellen.')}
      </section>

      <div class="dashboard-columns">
        <section class="card">
          <div class="card-header">
            <div><span class="eyebrow">Deals</span><h2>Aanbiedingenstatus</h2></div>
            <button class="text-button" type="button" data-nav="deals">Open deals</button>
          </div>
          ${renderDealsStatus()}
        </section>

        <section class="card">
          <div class="card-header">
            <div><span class="eyebrow">Activiteit</span><h2>Recent</h2></div>
          </div>
          ${renderActivity()}
        </section>
      </div>
      <p class="sr-only">Totale genormaliseerde voorraadhoeveelheid: ${totalUnits}</p>
    </div>`;
}

function renderInventory() {
  const search = canonicalProductName(ui.inventorySearch);
  const filtered = state.inventory
    .filter((item) => !search || canonicalProductName(item.name).includes(search))
    .sort((a, b) => a.category.localeCompare(b.category, 'nl') || a.name.localeCompare(b.name, 'nl'));
  const groups = groupBy(filtered, (item) => item.category || categorizeProduct(item.name));

  return `
    <div class="page">
      <header class="page-heading">
        <div><span class="eyebrow">Lokaal op dit toestel</span><h1>Voorraad</h1><p>Vink een product af wanneer het volledig is gebruikt, of pas de hoeveelheid aan.</p></div>
        <button class="button small" type="button" data-action="open-add-inventory">＋ Product</button>
      </header>

      <div class="search-bar">
        <input id="inventory-search" type="search" value="${escapeAttr(ui.inventorySearch)}" placeholder="Zoek in voorraad" autocomplete="off" aria-label="Zoek in voorraad" />
        <button class="button secondary small" type="button" data-action="open-import">Importeer</button>
      </div>

      ${state.inventory.length === 0
        ? emptyState('🧺', 'Je voorraad is nog leeg', 'Importeer je gekochte boodschappen vanuit Samsung Notes of voeg producten handmatig toe.', '<button class="button" type="button" data-action="open-import">Importeren</button>')
        : filtered.length === 0
          ? emptyState('⌕', 'Geen producten gevonden', 'Probeer een andere zoekterm.')
          : `<div class="grid" id="inventory-groups">${Object.entries(groups).map(([category, items]) => inventoryGroup(category, items)).join('')}</div>`}
    </div>`;
}

function inventoryGroup(category, items) {
  return `
    <section class="inventory-group" data-inventory-group>
      <div class="group-title"><span>${escapeHtml(category)}</span><span>${items.length}</span></div>
      <ul class="list">
        ${items.map((item) => `
          <li class="inventory-row" data-inventory-key="${escapeAttr(canonicalProductName(item.name))}">
            <label class="check-control" title="Volledig gebruikt">
              <input type="checkbox" data-action="consume-product" data-id="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.name)} volledig gebruikt" />
            </label>
            <div class="row-copy"><strong>${escapeHtml(item.name)}</strong><small>${formatQuantity(item.quantity, item.unit)} · ${escapeHtml(item.source || 'handmatig')}</small></div>
            <div class="stepper" aria-label="Hoeveelheid aanpassen">
              <button type="button" data-action="adjust-inventory" data-id="${escapeAttr(item.id)}" data-direction="-1" aria-label="Minder ${escapeAttr(item.name)}">−</button>
              <button type="button" data-action="adjust-inventory" data-id="${escapeAttr(item.id)}" data-direction="1" aria-label="Meer ${escapeAttr(item.name)}">＋</button>
            </div>
          </li>`).join('')}
      </ul>
    </section>`;
}

function renderWeek() {
  const planned = state.plannedRecipes.map((id) => recipeMap.get(id)).filter(Boolean);
  const plannedSet = new Set(state.plannedRecipes);
  const suggestions = rankRecipes(
    RECIPE_LIBRARY.filter((recipe) => !plannedSet.has(recipe.id)),
    state.inventory,
    state.settings,
  ).slice(0, 8);

  return `
    <div class="page">
      <header class="page-heading">
        <div><span class="eyebrow">Voor ${state.settings.householdSize} personen</span><h1>Weekmenu</h1><p>Recepten met de beste dekking uit je voorraad staan bovenaan.</p></div>
        <button class="button small" type="button" data-action="propose-week">↻ Voorstel</button>
      </header>

      <section class="card">
        <div class="card-header">
          <div><span class="eyebrow">Gepland</span><h2>${planned.length ? `${planned.length} recepten deze week` : 'Nog niets gepland'}</h2><p>Vink “gekookt” aan om de gebruikte ingrediënten van je voorraad af te trekken.</p></div>
          ${planned.length ? '<button class="text-button" type="button" data-action="generate-shopping">Winkellijst bijwerken</button>' : ''}
        </div>
        ${planned.length
          ? `<div class="recipe-list">${planned.map((recipe) => plannedRecipeCard(recipe)).join('')}</div>`
          : emptyState('📅', 'Maak je eerste weekvoorstel', 'Voorraadmaat kiest recepten die zoveel mogelijk ingrediënten gebruiken die je al hebt.', '<button class="button" type="button" data-action="propose-week">Maak voorstel</button>')}
      </section>

      <section class="card">
        <div class="card-header">
          <div><span class="eyebrow">Meer inspiratie</span><h2>Recepten op voorraadmatch</h2></div>
        </div>
        <div class="recipe-list two-column">${suggestions.map((entry) => recipeSuggestionCard(entry)).join('')}</div>
      </section>
    </div>`;
}

function plannedRecipeCard(recipe) {
  const ingredients = missingForRecipe(recipe, state.inventory, state.settings);
  const coverage = Math.round(ingredients.reduce((sum, item) => sum + item.coverage, 0) / Math.max(1, ingredients.length) * 100);
  const missing = ingredients.filter((ingredient) => ingredient.missing > 0.0001);
  return `
    <article class="recipe-card">
      <div class="recipe-main">
        <div class="recipe-emoji" aria-hidden="true">${recipe.emoji}</div>
        <div class="recipe-copy">
          <h3>${escapeHtml(recipe.title)}</h3>
          <p>${recipe.minutes} min · ${coverage}% in huis · ${recipe.tags.map(escapeHtml).join(' · ')}</p>
        </div>
        <label class="recipe-check"><input type="checkbox" data-action="cook-recipe" data-id="${escapeAttr(recipe.id)}" /><span>Gekookt</span></label>
      </div>
      <div class="progress" aria-label="${coverage}% van ingrediënten in huis"><span style="--progress:${coverage}%"></span></div>
      <div class="chips">
        ${missing.length ? missing.slice(0, 4).map((ingredient) => `<span class="chip warning">Nog ${formatQuantity(ingredient.missing, ingredient.unit)} ${escapeHtml(ingredient.name)}</span>`).join('') : '<span class="chip success">Alles in huis</span>'}
      </div>
      <div class="inline-actions">
        <button class="button secondary small" type="button" data-action="view-recipe" data-id="${escapeAttr(recipe.id)}">Bekijk recept</button>
        <button class="text-button" type="button" data-action="unplan-recipe" data-id="${escapeAttr(recipe.id)}">Verwijder uit week</button>
      </div>
    </article>`;
}

function recipeSuggestionCard(entry) {
  const { recipe, coverage, missingCount } = entry;
  const percentage = Math.round(coverage * 100);
  const planned = state.plannedRecipes.includes(recipe.id);
  return `
    <article class="recipe-card">
      <div class="recipe-main">
        <div class="recipe-emoji" aria-hidden="true">${recipe.emoji}</div>
        <div class="recipe-copy"><h3>${escapeHtml(recipe.title)}</h3><p>${recipe.minutes} min · ${missingCount === 0 ? 'alles in huis' : `${missingCount} ingrediënten missen`}</p></div>
      </div>
      <div class="progress" aria-label="${percentage}% van ingrediënten in huis"><span style="--progress:${percentage}%"></span></div>
      <div class="inline-actions">
        <button class="button small" type="button" data-action="${planned ? 'unplan-recipe' : 'plan-recipe'}" data-id="${escapeAttr(recipe.id)}">${planned ? 'Gepland ✓' : 'Plan recept'}</button>
        <button class="button secondary small" type="button" data-action="view-recipe" data-id="${escapeAttr(recipe.id)}">Details</button>
      </div>
    </article>`;
}

function renderShopping() {
  const active = state.shopping.filter((item) => !item.checked);
  const groups = routeShoppingList(active, deals, state.settings.selectedStores);
  const orderedStores = [...state.settings.selectedStores, 'unassigned'];
  const sections = orderedStores
    .filter((store) => groups[store]?.length)
    .map((store) => shoppingStoreSection(store, groups[store]))
    .join('');

  return `
    <div class="page">
      <header class="page-heading">
        <div><span class="eyebrow">Slim gegroepeerd</span><h1>Winkellijst</h1><p>Ontbrekende ingrediënten worden gekoppeld aan de beste gevonden deal per geselecteerde supermarkt.</p></div>
        <button class="button small" type="button" data-action="open-add-shopping">＋ Item</button>
      </header>

      <div class="actions">
        <button class="button" type="button" data-action="generate-shopping">Van weekmenu maken</button>
        <button class="button secondary" type="button" data-action="share-shopping" ${active.length ? '' : 'disabled'}>Delen</button>
      </div>

      ${dealsMeta.status === 'loading' ? '<div class="notice">Actuele aanbiedingen voor je lijst worden gezocht…</div>' : ''}
      ${dealsMeta.status === 'error' ? '<div class="notice error">Live deals konden niet worden geladen. Je lijst blijft volledig bruikbaar.</div>' : ''}
      ${renderShoppingDealSummary()}

      ${active.length
        ? `<div class="grid">${sections}</div>`
        : emptyState('🛒', 'Je winkellijst is leeg', 'Plan recepten en laat de ontbrekende ingrediënten automatisch toevoegen, of voeg zelf een item toe.', '<button class="button" type="button" data-action="generate-shopping">Maak van weekmenu</button>')}
    </div>`;
}

function shoppingStoreSection(store, items) {
  const total = items.reduce((sum, item) => sum + Number(item.bestDeal?.price || 0), 0);
  const totalLabel = total > 0 ? `vanaf ${formatCurrency(total)}` : `${items.length} item${items.length === 1 ? '' : 's'}`;
  return `
    <section class="store-section">
      <div class="store-heading"><strong>${escapeHtml(STORE_LABELS[store] || store)}</strong><span>${totalLabel}</span></div>
      <ul class="list">
        ${items.map((item) => `
          <li class="shopping-row">
            <label class="check-control" title="Gekocht en aan voorraad toevoegen"><input type="checkbox" data-action="buy-shopping" data-id="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.name)} gekocht" /></label>
            <div class="row-copy">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${formatQuantity(item.quantity, item.unit)}${item.bestDeal ? ` · ${escapeHtml(item.bestDeal.name)}` : ' · geen passende actie gevonden'}</small>
            </div>
            ${item.bestDeal
              ? `<div class="deal-price"><strong>${formatCurrency(item.bestDeal.price)}</strong>${item.bestDeal.originalPrice ? `<del>${formatCurrency(item.bestDeal.originalPrice)}</del>` : ''}</div>`
              : `<button class="mini-button" type="button" data-action="delete-shopping" data-id="${escapeAttr(item.id)}" aria-label="Verwijder ${escapeAttr(item.name)}">×</button>`}
          </li>`).join('')}
      </ul>
    </section>`;
}

function renderDeals() {
  const active = deals.filter((deal) => isDealActive(deal));
  const storeFiltered = ui.dealStore === 'all'
    ? active
    : active.filter((deal) => deal.retailer === ui.dealStore);
  const categoryFiltered = ui.dealCategory === 'all'
    ? storeFiltered
    : storeFiltered.filter(
        (deal) => dealCategorySlug(deal.category, deal.name) === ui.dealCategory
      );
  const search = canonicalProductName(ui.dealSearch);
  const filtered = categoryFiltered
    .filter((deal) => !search || canonicalProductName(deal.name).includes(search))
    .sort(
      (a, b) =>
        (b.discountPercentage || 0) - (a.discountPercentage || 0) ||
        Number(a.price || Infinity) - Number(b.price || Infinity)
    );

  const sourceDescription = ui.dealSearch
    ? `Zoeken binnen de actuele topdeals naar “${escapeHtml(ui.dealSearch)}”`
    : ui.dealCategory === 'all'
      ? 'Actuele topdeals van je geselecteerde supermarkten'
      : `Topdeals in ${escapeHtml(dealCategoryLabel(ui.dealCategory))}`;

  return `
    <div class="page">
      <header class="page-heading">
        <div><span class="eyebrow">${dealsMeta.generatedAt ? `Bijgewerkt ${escapeHtml(formatDealTimestamp(dealsMeta.generatedAt))}` : 'Aanbiedingenfeed'}</span><h1>Deals</h1><p>${sourceDescription}. Prijzen blijven indicatief; controleer ze bij de supermarkt.</p></div>
        <button class="button secondary small" type="button" data-action="refresh-deals">↻ Ververs</button>
      </header>

      <div class="segmented" aria-label="Filter op supermarkt">
        <button type="button" data-action="set-deal-store" data-store="all" aria-pressed="${ui.dealStore === 'all'}">Alle</button>
        ${state.settings.selectedStores.map((store) => `<button type="button" data-action="set-deal-store" data-store="${escapeAttr(store)}" aria-pressed="${ui.dealStore === store}">${escapeHtml(STORE_LABELS[store])}</button>`).join('')}
      </div>

      <div class="category-strip" aria-label="Filter op categorie">
        ${DEAL_CATEGORIES.map((category) => `<button type="button" data-action="set-deal-category" data-category="${escapeAttr(category.slug)}" aria-pressed="${ui.dealCategory === category.slug}">${escapeHtml(category.label)}</button>`).join('')}
      </div>

      <div class="search-bar"><input id="deal-search" type="search" value="${escapeAttr(ui.dealSearch)}" placeholder="Zoek product of merk" autocomplete="off" aria-label="Zoek aanbiedingen" /></div>

      ${renderDealsStatus()}

      ${filtered.length
        ? `<div class="deal-grid" id="deal-grid">${filtered.map(dealCard).join('')}</div>`
        : emptyState(
            '🏷️',
            ui.dealSearch
              ? `Geen deals gevonden voor “${escapeHtml(ui.dealSearch)}”`
              : 'Geen aanbiedingen in deze selectie',
            ui.dealSearch
              ? 'Probeer een bredere zoekterm of kies een andere supermarkt.'
              : 'Kies een andere categorie of laad de feed opnieuw.'
          )}

    </div>`;
}

function dealCard(deal) {
  const category = normalizeDealCategory(deal.category, deal.name);
  const validity = deal.validUntil ? `t/m ${formatDate(deal.validUntil)}` : '';
  const promotion = meaningfulPromotion(deal.promotionType);
  const detail = deal.quantity || deal.unitPrice || deal.brand || '';

  return `
    <article class="deal-card" data-deal-key="${escapeAttr(canonicalProductName(deal.name))}">
      <div>
        <span class="eyebrow">${escapeHtml(STORE_LABELS[deal.retailer] || deal.retailer)}</span>
        <span class="deal-category">${escapeHtml(category)}</span>
        <h3>${escapeHtml(deal.name)}</h3>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
      </div>
      <div>
        <div class="price-line"><strong>${formatCurrency(deal.price)}</strong>${deal.originalPrice ? `<del>${formatCurrency(deal.originalPrice)}</del>` : ''}</div>
        <div class="meta-row">
          ${validity ? `<span class="chip">${escapeHtml(validity)}</span>` : ''}
          ${promotion ? `<span class="chip">${escapeHtml(promotion)}</span>` : ''}
          ${deal.discountPercentage ? `<span class="chip success">-${Math.round(deal.discountPercentage)}%</span>` : ''}
        </div>
        <button class="button secondary small" type="button" data-action="add-deal-to-shopping" data-id="${escapeAttr(deal.id)}">Op lijst</button>
      </div>
    </article>`;
}

function renderDealsStatus() {
  if (dealsMeta.status === 'loading') {
    return '<div class="notice">Actuele topdeals worden geladen…</div>';
  }
  if (dealsMeta.status === 'error') {
    return `<div class="notice error">${escapeHtml(dealsMeta.error || 'De topaanbiedingen zijn nu niet bereikbaar.')} Je voorraad, recepten en winkellijst blijven offline werken.</div>`;
  }

  const activeCount = deals.filter((deal) => isDealActive(deal)).length;
  return `<div class="notice success">${activeCount} actuele topdeals geladen via <a href="https://www.prijsprofeet.nl" target="_blank" rel="noreferrer">PrijsProfeet</a>.</div>`;
}

function renderShoppingDealSummary() {
  const plan = dealOptimization?.bestPlan;
  if (!plan || !plan.assignments?.length) return '';

  const stores = plan.storeLabels.join(' + ');
  const secondStoreText = dealOptimization.savingsFromSecondStore > 0
    ? ` Twee winkels besparen naar schatting nog ${formatCurrency(dealOptimization.savingsFromSecondStore)}.`
    : '';

  return `<div class="notice success"><strong>Slim voorstel:</strong> ${escapeHtml(stores)} · ${plan.matchedItemCount} van ${plan.totalItemCount} producten gekoppeld · actietotaal ${formatCurrency(plan.productTotal)}.${secondStoreText}</div>`;
}

function renderActivity() {
  if (!state.activity.length) return emptyState('↺', 'Nog geen activiteit', 'Importeer producten of plan een recept; je recente wijzigingen verschijnen hier.');
  return `<ul class="list">${state.activity.slice(0, 5).map((entry) => `
    <li class="activity-row"><span class="activity-icon">${activityIcon(entry.type)}</span><div class="row-copy"><strong>${escapeHtml(entry.message)}</strong><small>${escapeHtml(formatActivityTime(entry.at))}</small></div></li>`).join('')}</ul>`;
}

function createWeekProposal() {
  if (!state.inventory.length) {
    openImportDialog();
    showToast('Importeer eerst je voorraad voor een persoonlijk voorstel.');
    return;
  }
  rememberUndo();
  state.plannedRecipes = proposeWeek(RECIPE_LIBRARY, state.inventory, state.settings);
  generateShoppingList(false);
  logActivity('recipe', `${state.plannedRecipes.length} recepten voorgesteld voor deze week`);
  saveState();
  currentView = 'week';
  render();
  showToast('Nieuw weekvoorstel gemaakt.', true);
}

function toggleRecipePlan(recipeId, shouldPlan) {
  const recipe = recipeMap.get(recipeId);
  if (!recipe) return;
  rememberUndo();
  const set = new Set(state.plannedRecipes);
  if (shouldPlan) set.add(recipeId);
  else set.delete(recipeId);
  state.plannedRecipes = [...set];
  generateShoppingList(false);
  logActivity('recipe', `${recipe.title} ${shouldPlan ? 'gepland' : 'uit de planning gehaald'}`);
  saveState();
  modal.close();
  render();
  showToast(shouldPlan ? 'Recept aan weekmenu toegevoegd.' : 'Recept uit weekmenu gehaald.', true);
}

function markRecipeCooked(recipeId) {
  const recipe = recipeMap.get(recipeId);
  if (!recipe) return;
  rememberUndo();
  const result = consumeRecipe(recipe, state.inventory, state.settings);
  state.inventory = result.inventory;
  state.plannedRecipes = state.plannedRecipes.filter((id) => id !== recipeId);
  state.completedRecipes.unshift({ id: recipeId, cookedAt: new Date().toISOString() });
  state.completedRecipes = state.completedRecipes.slice(0, 50);
  generateShoppingList(false);
  logActivity('cooked', `${recipe.title} gekookt; ${result.deductions.length} voorraadregels bijgewerkt`);
  saveState();
  render();
  const shortageText = result.shortages.length ? ` ${result.shortages.length} ingrediënt(en) waren niet volledig in voorraad.` : '';
  showToast(`Ingrediënten afgetrokken.${shortageText}`, true);
}

function consumeInventoryItem(id) {
  const item = state.inventory.find((candidate) => candidate.id === id);
  if (!item) return;
  rememberUndo();
  state.inventory = state.inventory.filter((candidate) => candidate.id !== id);
  logActivity('used', `${item.name} volledig gebruikt`);
  saveState();
  render();
  showToast(`${item.name} verwijderd uit voorraad.`, true);
}

function adjustInventory(id, direction) {
  const item = state.inventory.find((candidate) => candidate.id === id);
  if (!item || !direction) return;
  rememberUndo();
  const step = item.unit === 'st' ? 1 : 100;
  item.quantity = Math.max(0, Math.round((Number(item.quantity) + direction * step) * 100) / 100);
  if (item.quantity <= 0) state.inventory = state.inventory.filter((candidate) => candidate.id !== id);
  item.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast(`${item.name}: ${item.quantity > 0 ? formatQuantity(item.quantity, item.unit) : 'verwijderd'}.`, true);
}

function generateShoppingList(announce = true) {
  const generated = buildShoppingListFromPlan(state.plannedRecipes, RECIPE_LIBRARY, state.inventory, state.settings);
  state.shopping = mergeShoppingLists(state.shopping, generated);
  saveState();
  if (announce) {
    logActivity('shopping', `Winkellijst bijgewerkt met ${generated.length} ontbrekende ingrediënten`);
    saveState();
    render();
    showToast('Winkellijst bijgewerkt.');
  }
  loadDeals();
}

function markShoppingBought(id) {
  const item = state.shopping.find((candidate) => candidate.id === id);
  if (!item) return;
  rememberUndo();
  state.inventory = addItemsToInventory(state.inventory, [{
    name: item.name,
    key: item.key || canonicalProductName(item.name),
    quantity: item.quantity,
    unit: item.unit,
    category: categorizeProduct(item.name),
  }], 'winkellijst');
  state.shopping = state.shopping.filter((candidate) => candidate.id !== id);
  logActivity('bought', `${item.name} gekocht en aan voorraad toegevoegd`);
  saveState();
  render();
  showToast(`${item.name} staat nu in je voorraad.`, true);
  loadDeals();
}

function removeShoppingItem(id) {
  const item = state.shopping.find((candidate) => candidate.id === id);
  if (!item) return;
  rememberUndo();
  state.shopping = state.shopping.filter((candidate) => candidate.id !== id);
  saveState();
  render();
  showToast(`${item.name} van de winkellijst verwijderd.`, true);
  loadDeals();
}

function addDealToShopping(dealId) {
  const deal = deals.find((candidate) => candidate.id === dealId);
  if (!deal) return;
  const key = canonicalProductName(deal.name);
  if (state.shopping.some((item) => item.key === key)) {
    showToast('Dit product staat al op je winkellijst.');
    return;
  }
  rememberUndo();
  state.shopping.push({
    id: createId('shop'),
    name: deal.name,
    key,
    quantity: 1,
    unit: 'st',
    source: 'deal',
    preferredStore: deal.retailer,
    checked: false,
  });
  logActivity('shopping', `${deal.name} vanaf deals toegevoegd`);
  saveState();
  showToast('Deal aan winkellijst toegevoegd.', true);
  loadDeals();
}

function openImportDialog(initialText = '') {
  modal.innerHTML = `
    <form id="import-form" class="modal-shell">
      <header class="modal-header"><div><span class="eyebrow">Samsung Notes of tekstbestand</span><h2>Boodschappen importeren</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Sluiten">×</button></header>
      <div class="modal-body form-grid">
        <div class="notice">De app herkent onder meer “2x melk”, “1,5 kg aardappelen”, “bananen 6” en regels met vinkvakjes.</div>
        <label class="field-label">Plak of bewerk je lijst<textarea id="import-text" class="field" name="text" placeholder="2x melk\n1 kg aardappelen\n6 bananen">${escapeHtml(initialText)}</textarea></label>
        <label class="field-label">Of kies een tekst-, Markdown- of Samsung Notes-bestand<input id="import-file" class="field" type="file" accept=".txt,.md,.sdocx,text/plain,text/markdown,application/zip,application/octet-stream" /></label>
        <div><strong id="import-count">0 producten herkend</strong><div id="import-preview" class="preview-list"></div></div>
      </div>
      <footer class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Annuleren</button><button class="button" type="submit">Voeg toe aan voorraad</button></footer>
    </form>`;
  modal.showModal();
  requestAnimationFrame(() => {
    renderImportPreview(initialText);
    document.querySelector('#import-text')?.focus();
  });
}

function renderImportPreview(text) {
  const preview = document.querySelector('#import-preview');
  const count = document.querySelector('#import-count');
  if (!preview || !count) return;
  const items = parseGroceryText(text);
  count.textContent = `${items.length} product${items.length === 1 ? '' : 'en'} herkend`;
  preview.innerHTML = items.length
    ? items.map((item) => `<div class="preview-row"><span>${escapeHtml(item.name)}</span><strong>${formatQuantity(item.quantity, item.unit)}</strong></div>`).join('')
    : '<div class="muted">Nog geen bruikbare regels gevonden.</div>';
}

function submitGroceryImport(form) {
  const formData = new FormData(form);
  const text = String(formData.get('text') || '');
  const items = parseGroceryText(text);
  if (!items.length) {
    showToast('Geen producten herkend. Zet elk product op een eigen regel.');
    return;
  }
  rememberUndo();
  state.inventory = addItemsToInventory(state.inventory, items, 'Samsung Notes/import');
  logActivity('import', `${items.length} producten geïmporteerd`);
  saveState();
  modal.close();
  render();
  showToast(`${items.length} producten aan je voorraad toegevoegd.`, true);
}

async function readGroceryFile(file) {
  if (!file) return;

  const isSamsungNote = /\.sdocx$/i.test(file.name);
  const isTextFile =
    /\.(txt|md)$/i.test(file.name) ||
    ['text/plain', 'text/markdown'].includes(file.type);

  if (!isSamsungNote && !isTextFile) {
    showToast('Kies een .txt-, .md- of Samsung Notes .sdocx-bestand.');
    return;
  }

  try {
    if (isSamsungNote) {
      showToast('Samsung Note wordt uitgelezen…');
    }

    const text = isSamsungNote
      ? await extractSamsungNoteText(file)
      : await file.text();

    const textarea = document.querySelector('#import-text');
    if (textarea) {
      textarea.value = text;
      renderImportPreview(text);
      textarea.focus();
    }

    const recognizedCount = parseGroceryText(text).length;
    showToast(
      recognizedCount
        ? `${recognizedCount} producten uit ${file.name} herkend.`
        : 'Het bestand is gelezen, maar er zijn nog geen producten herkend.'
    );
  } catch (error) {
    console.error('Importbestand kon niet worden gelezen', error);
    showToast(
      error instanceof Error
        ? error.message
        : 'Het bestand kon niet worden gelezen.'
    );
  }
}

function openAddInventoryDialog() {
  modal.innerHTML = `
    <form id="inventory-form" class="modal-shell">
      <header class="modal-header"><div><span class="eyebrow">Voorraad</span><h2>Product toevoegen</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Sluiten">×</button></header>
      <div class="modal-body form-grid">
        <label class="field-label">Productnaam<input class="field" name="name" required autocomplete="off" placeholder="Bijv. melk" /></label>
        <div class="form-grid two">
          <label class="field-label">Hoeveelheid<input class="field" name="quantity" required type="number" min="0.01" step="0.01" value="1" /></label>
          <label class="field-label">Eenheid<select class="field" name="unit"><option value="st">stuks / verpakkingen</option><option value="g">gram</option><option value="ml">milliliter</option></select></label>
        </div>
      </div>
      <footer class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Annuleren</button><button class="button" type="submit">Toevoegen</button></footer>
    </form>`;
  modal.showModal();
  requestAnimationFrame(() => modal.querySelector('[name="name"]')?.focus());
}

function submitInventoryItem(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const quantity = Number(data.get('quantity') || 0);
  const unit = String(data.get('unit') || 'st');
  if (!name || quantity <= 0) return;
  rememberUndo();
  state.inventory = addItemsToInventory(state.inventory, [{ name, key: canonicalProductName(name), quantity, unit, category: categorizeProduct(name) }], 'handmatig');
  logActivity('import', `${name} handmatig toegevoegd`);
  saveState();
  modal.close();
  render();
  showToast(`${name} toegevoegd aan voorraad.`, true);
}

function openAddShoppingDialog() {
  modal.innerHTML = `
    <form id="shopping-form" class="modal-shell">
      <header class="modal-header"><div><span class="eyebrow">Winkellijst</span><h2>Item toevoegen</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Sluiten">×</button></header>
      <div class="modal-body form-grid">
        <label class="field-label">Productnaam<input class="field" name="name" required autocomplete="off" placeholder="Bijv. koffie" /></label>
        <div class="form-grid two">
          <label class="field-label">Hoeveelheid<input class="field" name="quantity" required type="number" min="0.01" step="0.01" value="1" /></label>
          <label class="field-label">Eenheid<select class="field" name="unit"><option value="st">stuks / verpakkingen</option><option value="g">gram</option><option value="ml">milliliter</option></select></label>
        </div>
      </div>
      <footer class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Annuleren</button><button class="button" type="submit">Op winkellijst</button></footer>
    </form>`;
  modal.showModal();
  requestAnimationFrame(() => modal.querySelector('[name="name"]')?.focus());
}

function submitShoppingItem(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const quantity = Number(data.get('quantity') || 0);
  const unit = String(data.get('unit') || 'st');
  if (!name || quantity <= 0) return;
  rememberUndo();
  state.shopping.push({
    id: createId('shop'),
    name,
    key: canonicalProductName(name),
    quantity,
    unit,
    source: 'handmatig',
    checked: false,
  });
  logActivity('shopping', `${name} handmatig op winkellijst gezet`);
  saveState();
  modal.close();
  render();
  showToast(`${name} staat op je winkellijst.`, true);
  loadDeals();
}

function openRecipeDialog(recipeId) {
  const recipe = recipeMap.get(recipeId);
  if (!recipe) return;
  const ingredients = missingForRecipe(recipe, state.inventory, state.settings);
  const planned = state.plannedRecipes.includes(recipeId);
  const pantry = scaledIngredients(recipe, state.settings.householdSize, true).filter((ingredient) => ingredient.pantry);
  modal.innerHTML = `
    <div class="modal-shell">
      <header class="modal-header"><div><span class="eyebrow">${recipe.minutes} minuten · ${state.settings.householdSize} personen</span><h2>${escapeHtml(recipe.title)}</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Sluiten">×</button></header>
      <div class="modal-body">
        <div class="recipe-detail-hero"><div class="recipe-emoji">${recipe.emoji}</div><div><p>${escapeHtml(recipe.description)}</p><div class="chips">${recipe.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div></div></div>
        <h3>Ingrediënten</h3>
        <div>${ingredients.map((ingredient) => `
          <div class="ingredient-row ${ingredient.missing > 0.0001 ? 'missing' : ''}"><span>${escapeHtml(ingredient.name)}</span><strong>${formatQuantity(ingredient.quantity, ingredient.unit)} ${ingredient.missing > 0.0001 ? `· nog ${formatQuantity(ingredient.missing, ingredient.unit)}` : '· in huis'}</strong></div>`).join('')}</div>
        ${pantry.length ? `<p class="muted">Kastbasis: ${pantry.map((item) => escapeHtml(item.name)).join(', ')}.</p>` : ''}
        <hr />
        <h3>Bereiding</h3>
        <ol class="steps">${recipe.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
      </div>
      <footer class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Sluiten</button><button class="button" type="button" data-action="${planned ? 'unplan-recipe' : 'plan-recipe'}" data-id="${escapeAttr(recipe.id)}">${planned ? 'Uit weekmenu halen' : 'Plan dit recept'}</button></footer>
    </div>`;
  modal.showModal();
}

function openSettingsDialog() {
  modal.innerHTML = `
    <form id="settings-form" class="modal-shell">
      <header class="modal-header"><div><span class="eyebrow">Voorkeuren & gegevens</span><h2>Instellingen</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Sluiten">×</button></header>
      <div class="modal-body settings-grid">
        <div class="form-grid two">
          <label class="field-label">Personen<input class="field" type="number" name="householdSize" min="1" max="12" value="${state.settings.householdSize}" /></label>
          <label class="field-label">Recepten per week<input class="field" type="number" name="recipesPerWeek" min="1" max="7" value="${state.settings.recipesPerWeek}" /></label>
        </div>
        <div>
          <strong>Supermarkten meenemen</strong>
          <div class="store-checks">
            ${Object.entries(STORE_LABELS).filter(([key]) => key !== 'unassigned').map(([key, label]) => `<label class="store-check"><input type="checkbox" name="stores" value="${escapeAttr(key)}" ${state.settings.selectedStores.includes(key) ? 'checked' : ''} /><span>${escapeHtml(label)}</span></label>`).join('')}
          </div>
        </div>
        <label class="switch-row"><span><strong>Kastbasis meetellen</strong><br /><small class="muted">Denk aan olie, bouillon en kruiden.</small></span><input type="checkbox" name="includePantryStaples" ${state.settings.includePantryStaples ? 'checked' : ''} /></label>
        <hr />
        <div>
          <strong>Back-up</strong>
          <p class="muted">Voorraadmaat bewaart alles lokaal in deze browser. Exporteer af en toe een JSON-back-up als je van toestel wisselt.</p>
          <div class="actions"><button class="button secondary small" type="button" data-action="export-backup">Exporteer</button><button class="button secondary small" type="button" data-action="trigger-backup-import">Importeer back-up</button><input id="backup-import" class="sr-only" type="file" accept="application/json,.json" /></div>
        </div>
        <hr />
        <div><button class="button danger small" type="button" data-action="reset-data">Wis alle lokale gegevens</button></div>
      </div>
      <footer class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">Annuleren</button><button class="button" type="submit">Opslaan</button></footer>
    </form>`;
  modal.showModal();
}

function submitSettings(form) {
  const data = new FormData(form);
  const stores = data.getAll('stores').map(String);
  state.settings = {
    ...state.settings,
    householdSize: Math.min(12, Math.max(1, Number(data.get('householdSize') || DEFAULT_SETTINGS.householdSize))),
    recipesPerWeek: Math.min(7, Math.max(1, Number(data.get('recipesPerWeek') || DEFAULT_SETTINGS.recipesPerWeek))),
    selectedStores: stores.length ? stores : [...DEFAULT_SETTINGS.selectedStores],
    includePantryStaples: data.has('includePantryStaples'),
  };
  generateShoppingList(false);
  saveState();
  modal.close();
  render();
  showToast('Instellingen opgeslagen.');
  loadDeals({ force: true });
}

async function shareShoppingList() {
  const active = state.shopping.filter((item) => !item.checked);
  if (!active.length) return;
  const groups = routeShoppingList(active, deals, state.settings.selectedStores);
  const text = [...state.settings.selectedStores, 'unassigned']
    .filter((store) => groups[store]?.length)
    .map((store) => `${STORE_LABELS[store] || store}\n${groups[store].map((item) => `☐ ${formatQuantity(item.quantity, item.unit)} ${item.name}${item.bestDeal ? ` (${formatCurrency(item.bestDeal.price)})` : ''}`).join('\n')}`)
    .join('\n\n');

  try {
    if (navigator.share) await navigator.share({ title: 'Winkellijst Voorraadmaat', text });
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      showToast('Winkellijst naar het klembord gekopieerd.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Delen lukte niet op dit toestel.');
  }
}

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  modal.innerHTML = `
    <div class="modal-shell">
      <header class="modal-header"><div><span class="eyebrow">Android</span><h2>App installeren</h2></div><button class="close-button" type="button" data-action="close-modal" aria-label="Sluiten">×</button></header>
      <div class="modal-body"><p>Open deze site in Chrome op Android, kies het browsermenu en tik op <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong>. Na installatie verschijnt Voorraadmaat ook als deeldoel voor tekst uit Samsung Notes.</p></div>
      <footer class="modal-footer"><button class="button" type="button" data-action="close-modal">Begrepen</button></footer>
    </div>`;
  modal.showModal();
}

async function loadDeals({ announce = false, force = false } = {}) {
  const activeShopping = state.shopping.filter((item) => !item.checked);

  dealsMeta = { ...dealsMeta, status: 'loading', error: null };
  if (currentView === 'deals') render();

  try {
    const payload = await loadTopDeals(
      state.settings.selectedStores,
      { force }
    );

    deals = normalizeAndMergeDeals(payload.items || [], []);
    dealOptimization = buildDealOptimization(activeShopping);

    dealsMeta = {
      status: 'live',
      generatedAt: payload.retrievedAt || new Date().toISOString(),
      sourceType: 'top',
      mode: 'top-only',
      count: deals.length,
      error: null,
    };

    if (announce) {
      showToast(`${deals.length} actuele topdeals geladen.`);
    }
  } catch (error) {
    console.error('Top deals loading failed', error);
    deals = [];
    dealOptimization = null;
    dealsMeta = {
      status: 'error',
      generatedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };

    if (announce) {
      showToast('Topdeals konden niet worden geladen.');
    }
  }

  render();
}

function resetDealFeed() {
  deals = [];
  dealOptimization = null;
}

function effectiveDealRetailers() {
  return ui.dealStore === 'all'
    ? state.settings.selectedStores
    : [ui.dealStore];
}

function normalizeAndMergeDeals(rawDeals, existingDeals = []) {
  const unique = new Map();

  for (const rawDeal of [...existingDeals, ...rawDeals]) {
    const deal = normalizeDeal(rawDeal);
    if (!deal.retailer || deal.price == null || !isDealActive(deal)) continue;

    deal.category = normalizeDealCategory(deal.category, deal.name);
    const key = [
      deal.retailer,
      deal.id || canonicalProductName(deal.name),
      deal.price,
      deal.validUntil || '',
    ].join('|');

    if (!unique.has(key)) unique.set(key, deal);
  }

  return [...unique.values()];
}

function buildDealOptimization(activeShopping) {
  if (!activeShopping.length) return null;

  const indexEntries = deals.map((deal, index) => ({
    i: index,
    r: deal.retailer,
    n: deal.name,
    b: deal.brand || '',
    c: deal.category || '',
    p: deal.price,
    o: deal.originalPrice,
    d: deal.discountPercentage,
    q: deal.quantity || '',
    e: deal.ean || '',
    t: canonicalProductName(
      `${deal.name} ${deal.brand || ''} ${deal.category || ''}`
    ).split(' ').filter(Boolean),
  }));

  return optimizeShoppingList(activeShopping, { entries: indexEntries }, {
    retailers: state.settings.selectedStores,
    maxStores: 2,
    visitCost: 2.5,
  });
}

function normalizeDealCategory(value, productName = '') {
  const normalized = canonicalProductName(value || '');
  const exact = DEAL_CATEGORIES.find(
    (category) => canonicalProductName(category.label) === normalized
  );
  if (exact) return exact.label;

  const inferred = categorizeProduct(`${value || ''} ${productName || ''}`);
  const aliases = {
    'Groente & fruit': 'Groente & Fruit',
    'Zuivel & eieren': 'Zuivel & Eieren',
    'Vlees, vis & vega': 'Vlees & Gevogelte',
    'Brood & ontbijt': 'Brood & Bakkerij',
    'Pasta, rijst & wereldkeuken': 'Pasta, Rijst & Wereldkeuken',
    'Blik, pot & sauzen': 'Soepen, Conserven & Sauzen',
    Dranken: 'Frisdrank & Sappen',
    Huishouden: 'Huishouden & Dier',
    Overig: 'Overig',
  };

  return aliases[inferred] || value || inferred || 'Overig';
}

function dealCategorySlug(value, productName = '') {
  const label = normalizeDealCategory(value, productName);
  return DEAL_CATEGORIES.find(
    (category) => canonicalProductName(category.label) === canonicalProductName(label)
  )?.slug || 'overig';
}

function dealCategoryLabel(slug) {
  return DEAL_CATEGORIES.find((category) => category.slug === slug)?.label || 'Alle categorieën';
}

function meaningfulPromotion(value) {
  const promotion = String(value || '').trim();
  if (!promotion) return '';

  const generic = new Set([
    'active',
    'actief',
    'actie',
    'actuele actie',
    'promotion',
    'percentage',
  ]);

  return generic.has(promotion.toLowerCase()) ? '' : promotion;
}

function openBackupDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'Voorraadmaat',
    state,
  };
  const date = new Date().toISOString().slice(0, 10);
  openBackupDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `voorraadmaat-backup-${date}.json`);
  showToast('Back-upbestand aangemaakt.');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    rememberUndo();
    state = sanitizeState(payload.state || payload);
    saveState();
    modal.close();
    render();
    showToast('Back-up geïmporteerd.', true);
  } catch {
    showToast('Dit bestand is geen geldige Voorraadmaat-back-up.');
  }
}

function resetData() {
  if (!window.confirm('Weet je zeker dat je alle voorraad, planning en winkellijsten wilt wissen?')) return;
  rememberUndo();
  state = sanitizeState({});
  saveState();
  modal.close();
  render();
  showToast('Alle lokale gegevens zijn gewist.', true);
}

function handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title');
  const text = params.get('text');
  const url = params.get('url');
  const open = params.get('open');
  if (!title && !text && !url && !open) return;

  history.replaceState({}, '', window.location.pathname);
  const shared = [title ? `${title}:` : '', text, url].filter(Boolean).join('\n').trim();
  if (shared) {
    setTimeout(() => openImportDialog(shared), 50);
    return;
  }
  if (open === 'shopping') navigate('shopping');
  if (open === 'import') setTimeout(() => openImportDialog(), 50);
}

function filterInventoryRows(value) {
  const query = canonicalProductName(value);
  document.querySelectorAll('[data-inventory-key]').forEach((row) => {
    row.hidden = Boolean(query && !row.dataset.inventoryKey.includes(query));
  });
  document.querySelectorAll('[data-inventory-group]').forEach((group) => {
    group.hidden = ![...group.querySelectorAll('[data-inventory-key]')].some((row) => !row.hidden);
  });
}

function filterDealCards(value) {
  const query = canonicalProductName(value);
  document.querySelectorAll('[data-deal-key]').forEach((card) => {
    card.hidden = Boolean(query && !card.dataset.dealKey.includes(query));
  });
}

function rememberUndo() {
  undoSnapshot = JSON.stringify(state);
}

function restoreUndo() {
  if (!undoSnapshot) return;
  state = sanitizeState(JSON.parse(undoSnapshot));
  undoSnapshot = null;
  saveState();
  render();
  clearToast();
  showToast('Wijziging ongedaan gemaakt.');
}

function showToast(message, canUndo = false) {
  clearTimeout(toastTimer);
  toastRegion.innerHTML = `<div class="toast"><span>${escapeHtml(message)}</span>${canUndo && undoSnapshot ? '<button type="button" data-action="undo">Ongedaan maken</button>' : ''}</div>`;
  toastTimer = setTimeout(clearToast, canUndo ? 7000 : 4000);
}

function clearToast() {
  toastRegion.innerHTML = '';
}

function logActivity(type, message) {
  state.activity.unshift({ id: createId('activity'), type, message, at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 100);
}

function loadState() {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || '{}'));
  } catch {
    return sanitizeState({});
  }
}

function saveState() {
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('State could not be saved', error);
    showToast('Opslaan op dit toestel is mislukt. Controleer de browseropslag.');
  }
}

function updateConnectionStatus() {
  connectionStatus.textContent = navigator.onLine ? 'Alles lokaal bewaard' : 'Offline · voorraad blijft werken';
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.error('Service worker registration failed', error));
  }, { once: true });
}

function emptyState(icon, title, text, action = '') {
  return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action}</div>`;
}

function groupBy(items, selector) {
  return items.reduce((groups, item) => {
    const key = selector(item);
    groups[key] ??= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function activityIcon(type) {
  return ({ import: '↥', recipe: '♨', cooked: '✓', used: '−', shopping: '🛒', bought: '＋' })[type] || '•';
}

function formatActivityTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDealTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
