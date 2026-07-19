const DEALS_API_URL =
  'https://voorraadkast-deals.karsmorsink.workers.dev';

const DEFAULT_RETAILERS = [
  'albert_heijn',
  'dirk',
  'lidl',
  'hoogvliet',
  'plus',
];

export async function searchDeals(
  query,
  retailers = DEFAULT_RETAILERS
) {
  const url = new URL(
    `${DEALS_API_URL}/search`
  );

  url.searchParams.set(
    'q',
    query
  );

  for (const retailer of retailers) {
    url.searchParams.append(
      'retailer',
      retailer
    );
  }

  const response = await fetch(url);

  if (!response.ok) {
    const error =
      await response.json().catch(
        () => ({})
      );

    throw new Error(
      error.details ||
      error.error ||
      `Deal search failed: ${response.status}`
    );
  }

  return response.json();
}

export async function searchShoppingListDeals(
  shoppingItems,
  retailers = DEFAULT_RETAILERS
) {
  const queries = [
    ...new Set(
      shoppingItems
        .map((item) =>
          typeof item === 'string'
            ? item
            : item.name ||
              item.product ||
              item.label
        )
        .filter(Boolean)
    ),
  ];

  const response = await fetch(
    `${DEALS_API_URL}/batch`,
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body: JSON.stringify({
        queries,
        retailers,
      }),
    }
  );

  if (!response.ok) {
    const error =
      await response.json().catch(
        () => ({})
      );

    throw new Error(
      error.details ||
      error.error ||
      `Batch deal search failed: ${response.status}`
    );
  }

  return response.json();
}
