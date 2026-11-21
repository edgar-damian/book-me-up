export type SearchResultShop = {
  kind: "shop";
  slug: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  images: string[];
};

// SearchResultWorker.Shop on the server: a shop where the worker has an active chair.
export type WorkerShop = {
  slug: string;
  name: string;
  city: string;
  state: string;
};

export type SearchResultWorker = {
  kind: "worker";
  slug: string;
  first_name: string;
  last_name: string;
  image: string | null;
  shops: WorkerShop[];
};

// The location list mixes both; kind tells them apart.
export type SearchResult = SearchResultShop | SearchResultWorker;
