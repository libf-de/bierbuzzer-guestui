# Fetching Cloud Articles & Categories

How the cash-server imports articles and categories from the degaso cloud. This is the "Cloud Article Sync" (Cloud-Artikel synchronisieren) feature: it fetches articles, extras, extra-categories, and article-groups from the cloud and stores them into the local NeDB `productDb` / `categoryDb`.

## Overview

```
Frontend (cloud-import-popup)
    → GET  /integrations/cloud/article-groups   → user picks a group
    → POST /integrations/cloud/sync-articles     → import runs
        cash-server (ArticlesManager.syncFromCloud)
            → 7 parallel POSTs to https://api.alleskasse.de
            → maps cloud payloads → StoredArticle / Category
            → upserts into productDb / categoryDb
            → broadcasts productUpdate / categoryUpdate over WS
```

## Routes

Registered under the prefix `/integrations/cloud` (`src/routes/integrations/_index.ts:49`).

### `GET /integrations/cloud/article-groups`

Returns the list of cloud article groups so the user can pick one.

- **Params:** none
- **Response:** `CloudArticleGroup[]` — `{ _id, apiKey, name }`
- **Handler:** `_getCloudArticleGroups()` in `src/routes/integrations/degasoCloud/getCloudArticleGroups.ts`
- Calls `CloudManager.articleGroupsFetch()` → `POST /getArticleGroups`.

### `POST /integrations/cloud/sync-articles`

Triggers the import.

- **Body:**
  ```json
  { "articleGroupId": "string (required)", "mode": "merge | overwrite" }
  ```
  - `articleGroupId` missing → `400 { success: false, message: "articleGroupId fehlt" }`
  - `mode` defaults to `"overwrite"`. Any value other than `"merge"` is treated as `"overwrite"` (`syncCloudArticles.ts:14`).
- **Response:** `CloudSyncResult` — see [Return value](#return-value).
- **Handler:** `_syncCloudArticles()` in `src/routes/integrations/degasoCloud/syncCloudArticles.ts`
- Delegates to `ArticlesManager.syncFromCloud()`.

## Cloud API

- **Base URL:** `CloudManager.getServerUrl()` → `https://api.alleskasse.de` (`cloudManager.ts:196-202`)
- **Method:** every call is `POST`, header `Content-Type: application/json`
- **Auth:** `apiKey` in the JSON body. This is the customer key loaded from `configDb` doc `configName: 'customerData'` → `customerKey` (`cloudManager.ts:77-82`). Empty key throws `"Ungültiger Kundentoken"`.
- **Timeout:** 10000ms via `fetchWithTimeout()` (`src/utils/fetchUtils.ts`, `node-fetch` + AbortController).
- Every response must be a JSON array or an error is thrown; non-ok status also throws.

`syncFromCloud` fetches these seven in parallel (`articles.ts:455-465`):

| CloudManager call | URL | Request body | Response type |
|---|---|---|---|
| `articlesFetch()` | `POST /getArticles` | `{ apiKey }` | `CloudArticle[]` |
| `extrasFetch()` | `POST /getExtras` | `{ apiKey }` | `CloudExtra[]` |
| `articleExtrasFetch()` | `POST /getArticleExtras` | `{ apiKey, articleId?, extraId? }` | `CloudArticleExtra[]` |
| `extraCategoriesFetch()` | `POST /getExtraCategories` | `{ apiKey }` | `CloudExtraCategory[]` |
| `extraCategoryExtrasFetch()` | `POST /getExtraCategoryExtras` | `{ extraCategoryId?, extraId?, apiKey }` | `CloudExtraCategoryExtra[]` |
| `articleGroupArticlesFetch(id)` | `POST /getArticleGroupArticles` | `{ articleGroupId, apiKey }` | `CloudArticleGroupArticle[]` |
| `articleGroupCategoriesFetch(id)` | `POST /getArticleGroupCategories` | `{ articleGroupId, apiKey }` | `CloudArticleGroupCategory[]` |

The group-list route additionally calls `articleGroupsFetch()` → `POST /getArticleGroups`, body `{ apiKey }`, returns `CloudArticleGroup[]`.

All fetch calls live in `src/connectors/cloudManager.ts:914-1050`.

## Data transformation & storage

Core logic: `ArticlesManager.syncFromCloud()` (`src/connectors/articles.ts:451-645`).

Storage targets:
- `Database.productDb` — articles **and** extras, distinguished by the `combinationProduct` boolean (`false` = article, `true` = extra).
- `Database.categoryDb` — categories **and** extra-categories, distinguished by the `extraCategory` boolean.

### Scoping

The import is scoped to the chosen article group:

- `groupArticleById` = non-archived `CloudArticleGroupArticle` keyed by `articleId` (`articles.ts:469-471`).
- `scopedArticles` = cloud articles present in that group (`475`).
- `articleIdsByExtra` maps each extra to the group's article ids via `CloudArticleExtra` (`480-486`); `scopedExtras` = extras linked to at least one group article (`489`).
- Extra-categories scoped to those referenced by scoped extras via `CloudExtraCategoryExtra` (`493-506`).

### Writes

**Group categories → Category** (`525-545`): upsert `{ name, extraCategory: false }`. New docs get `color: '#cccccc', order: 0, visible: true`.

**Extra-categories → Category** (`548-569`): upsert `{ name, extraCategory: true }`. Same defaults.

**Articles → StoredArticle** (`572-588`), mapped by `cloudArticleToLocalFields()` (`articles.ts:40-57`):
- `price` = `groupArticle.price ?? cloudArticle.price`, as a `.toFixed(2)` string
- `tax` = `String(a.tax)`
- `combinationProduct: false`
- `color` = `a.color ?? '#cccccc'`
- carries `name, infoText, ean, plu`
- `category` = the group category's `name`
- New articles get `LOCAL_ARTICLE_DEFAULTS` (`21-31`): `active: true, order: 0, stockChecking: false, stockAmount: 0, category: '', showOnGimig: false, variablePrice: false, favorite: false, adultOnly: false`, plus optional `options.articleGuesser` overrides.

**Extras → ExtraArticle** (`591-608`), mapped by `cloudExtraToLocalFields()` (`59-78`):
- `combinationProduct: true`
- `price` as `.toFixed(2)` string
- `required` = extra-category's `requiresSelection`
- `availableProducts` = `[{ productId, productName }]` for linked articles
- `category` = extra-category name
- New extras get `LOCAL_EXTRA_DEFAULTS` (`33-38`): `active: true, order: 0, changetax: false, color: undefined`, plus optional `extraGuesser`.

### Merge vs overwrite

- Existing docs: cloud-mapped fields overwrite via `$set`; local-only fields (`active`, `order`, `category`, etc.) are preserved.
- **Deletion happens only in `overwrite` mode** (`articles.ts:611`): `if (mode !== 'overwrite')` returns early and skips deletion. In `overwrite` mode, local products/categories absent from the group are removed (`617-639`). In `merge` mode nothing is deleted.

> ⚠️ The JSDoc on `syncFromCloud` says "Documents present locally but absent from the cloud are deleted," but deletion is actually gated to `overwrite` mode only.

### Broadcasts

After writes:
- `broadcastProductUpdateDebounced()` — WS `productUpdate` + selfordering menu sync.
- `wss.broadcast('categoryUpdate')` if any categories changed.

### Return value

`CloudSyncResult` (`src/models/cloudArticles.ts:136-147`):

```ts
{ newArticles, newExtras, newCategories, modifiedIds, removedIds }
```

The full new docs are returned so the frontend can prompt the user to fill local-only fields (the popup's review step, `cloud-import-popup.component.ts:125-141`).

## Models

All cloud payload interfaces live in `src/models/cloudArticles.ts`:

- `CloudArticle` — `{ _id, apiKey, name, price: number, tax: number, combinationProduct, infoText?, color?, ean?, plu?, imageUrl?, isArchived? }`
- `CloudExtra`
- `CloudArticleExtra` — `{ articleId, extraId }`
- `CloudExtraCategory` — `{ name, requiresSelection }`
- `CloudExtraCategoryExtra` — `{ extraCategoryId, extraId, price, maxNumber }`
- `CloudArticleExtraCategory`
- `CloudArticleGroup` — `{ _id, apiKey, name }`
- `CloudArticleGroupCategory` — `{ articleGroupId, name, imageUrl? }`
- `CloudArticleGroupArticle` — `{ articleGroupId, articleId, price, categoryId?, isArchived? }`

Sync helper types: `LocalArticleFields`, `LocalExtraFields`, `ArticleFieldGuesser`, `ExtraFieldGuesser`, `CloudSyncOptions`, `CloudSyncResult`.

## Key files

| Concern | File | Symbol |
|---|---|---|
| Route factory | `src/routes/integrations/degasoCloud/_index.ts` | `getDegasoCloudRouter()` |
| Sync handler | `src/routes/integrations/degasoCloud/syncCloudArticles.ts` | `_syncCloudArticles()` |
| Group list handler | `src/routes/integrations/degasoCloud/getCloudArticleGroups.ts` | `_getCloudArticleGroups()` |
| Core sync logic | `src/connectors/articles.ts` | `syncFromCloud()`, `cloudArticleToLocalFields()`, `cloudExtraToLocalFields()` |
| Cloud fetch calls | `src/connectors/cloudManager.ts` | `*Fetch()` (lines 914-1050) |
| Models | `src/models/cloudArticles.ts` | `Cloud*`, `CloudSync*` |
| Fetch helper | `src/utils/fetchUtils.ts` | `fetchWithTimeout()` |
| Frontend trigger | `degaso-cash/src/app/article-manager/cloud-import-popup/cloud-import-popup.component.ts` | `loadGroups()`, `startSync()` |
