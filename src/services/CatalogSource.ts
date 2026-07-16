import { CatalogCategory } from "../db/types";

/**
 * Source of the catalog (categories + articles) an admin picks from when
 * building presets. Scoped by the account's apiKey. Two impls:
 *   - CloudCatalogSource  (degaso cloud, api.alleskasse.de)
 *   - MockCatalogSource   (static, for dev without network)
 */
export interface CatalogSource {
  listCategories(apiKey: string): Promise<CatalogCategory[]>;
}

// --- mock ---

export class MockCatalogSource implements CatalogSource {
  private readonly categories: CatalogCategory[] = [
    {
      name: "Bier",
      articles: [
        { _id: "664f0000000000000000b001", name: "Pils 0,3l", price: 3.2 },
        { _id: "664f0000000000000000b002", name: "Pils 0,5l", price: 4.5 },
        { _id: "664f0000000000000000b003", name: "Weißbier 0,5l", price: 4.9 },
        { _id: "664f0000000000000000b004", name: "Radler 0,5l", price: 4.2 },
      ],
    },
    {
      name: "Alkoholfrei",
      articles: [
        { _id: "664f0000000000000000a001", name: "Cola 0,3l", price: 3.0 },
        { _id: "664f0000000000000000a002", name: "Apfelschorle 0,5l", price: 3.6 },
        { _id: "664f0000000000000000a003", name: "Wasser 0,5l", price: 2.8 },
      ],
    },
    {
      name: "Spirituosen",
      articles: [
        { _id: "664f0000000000000000s001", name: "Schnaps 2cl", price: 2.5 },
        { _id: "664f0000000000000000s002", name: "Kräuter 2cl", price: 2.9 },
      ],
    },
  ];

  async listCategories(_apiKey: string): Promise<CatalogCategory[]> {
    return this.categories.map((c) => ({ name: c.name, articles: c.articles.map((a) => ({ ...a })) }));
  }
}

// --- degaso cloud ---

const UNCATEGORIZED = "Uncategorized";

interface CloudArticle {
  _id: string;
  name: string;
  price?: number;
  isArchived?: boolean;
}
interface CloudArticleGroup {
  _id: string;
  name: string;
}
interface CloudArticleGroupCategory {
  _id: string;
  articleGroupId: string;
  name: string;
}
interface CloudArticleGroupArticle {
  articleGroupId: string;
  articleId: string;
  price?: number;
  categoryId?: string;
  isArchived?: boolean;
}

export interface CloudCatalogOptions {
  baseUrl: string;
  timeoutMs: number;
}

/**
 * Fetches the account's catalog from the degaso cloud (see cloud-article-sync).
 * All calls: POST JSON, `apiKey` in the body. Articles are categorized via the
 * account's article groups; categories from all groups are merged by name.
 */
export class CloudCatalogSource implements CatalogSource {
  constructor(private readonly opts: CloudCatalogOptions) {}

  async listCategories(apiKey: string): Promise<CatalogCategory[]> {
    if (!apiKey) throw new Error("missing apiKey");

    const [articles, groups] = await Promise.all([
      this.post<CloudArticle>("/getArticles", { apiKey }),
      this.post<CloudArticleGroup>("/getArticleGroups", { apiKey }),
    ]);

    // articleId -> {name, price} (skip archived)
    const articleInfo = new Map<string, { name: string; price: number }>();
    for (const a of articles) {
      if (!a.isArchived) articleInfo.set(a._id, { name: a.name, price: a.price ?? 0 });
    }

    // categoryName -> (articleId -> article), merged across all groups
    const byCategory = new Map<string, Map<string, { _id: string; name: string; price: number }>>();

    await Promise.all(
      groups.map(async (group) => {
        const [cats, groupArticles] = await Promise.all([
          this.post<CloudArticleGroupCategory>("/getArticleGroupCategories", {
            articleGroupId: group._id,
            apiKey,
          }),
          this.post<CloudArticleGroupArticle>("/getArticleGroupArticles", {
            articleGroupId: group._id,
            apiKey,
          }),
        ]);

        const categoryName = new Map<string, string>();
        for (const c of cats) categoryName.set(c._id, c.name);

        for (const ga of groupArticles) {
          if (ga.isArchived) continue;
          const info = articleInfo.get(ga.articleId);
          if (!info) continue; // archived / unknown article
          const catName = (ga.categoryId && categoryName.get(ga.categoryId)) || UNCATEGORIZED;
          let bucket = byCategory.get(catName);
          if (!bucket) {
            bucket = new Map();
            byCategory.set(catName, bucket);
          }
          // group price overrides the base article price
          bucket.set(ga.articleId, {
            _id: ga.articleId,
            name: info.name,
            price: ga.price ?? info.price,
          });
        }
      }),
    );

    return [...byCategory.entries()]
      .map(([name, arts]) => ({ name, articles: [...arts.values()] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async post<T>(pathname: string, body: unknown): Promise<T[]> {
    const url = this.opts.baseUrl.replace(/\/$/, "") + pathname;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`cloud ${pathname} -> HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error(`cloud ${pathname} -> non-array response`);
      return json as T[];
    } finally {
      clearTimeout(timer);
    }
  }
}
