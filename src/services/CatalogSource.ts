import { CatalogCategory } from "../db/types";

/**
 * Source of the full available catalog (categories + articles) that an admin
 * picks from when configuring a device. In production this fronts the degaso
 * menu API; for now MockCatalogSource returns a static list.
 */
export interface CatalogSource {
  listCategories(): Promise<CatalogCategory[]>;
}

export class MockCatalogSource implements CatalogSource {
  private readonly categories: CatalogCategory[] = [
    {
      name: "Bier",
      articles: [
        { _id: "664f0000000000000000b001", name: "Pils 0,3l" },
        { _id: "664f0000000000000000b002", name: "Pils 0,5l" },
        { _id: "664f0000000000000000b003", name: "Weißbier 0,5l" },
        { _id: "664f0000000000000000b004", name: "Radler 0,5l" },
      ],
    },
    {
      name: "Alkoholfrei",
      articles: [
        { _id: "664f0000000000000000a001", name: "Cola 0,3l" },
        { _id: "664f0000000000000000a002", name: "Apfelschorle 0,5l" },
        { _id: "664f0000000000000000a003", name: "Wasser 0,5l" },
      ],
    },
    {
      name: "Spirituosen",
      articles: [
        { _id: "664f0000000000000000s001", name: "Schnaps 2cl" },
        { _id: "664f0000000000000000s002", name: "Kräuter 2cl" },
      ],
    },
  ];

  async listCategories(): Promise<CatalogCategory[]> {
    // Return a deep copy so callers can't mutate the mock source.
    return this.categories.map((c) => ({ name: c.name, articles: c.articles.map((a) => ({ ...a })) }));
  }
}
