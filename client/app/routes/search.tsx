import type { Route } from "./+types/search";
import { Search } from "../pages/Search";
import type { SearchResult } from "~/models/search";
import type { SearchBy } from "~/widgets/Search/searchBar";

// Each chip's list on the API, and the query param that narrows it.
const ENDPOINTS: Record<SearchBy, { path: string; param: string }> = {
  shop: { path: "/search/shops", param: "name" },
  provider: { path: "/search/workers", param: "name" },
  location: { path: "/search/locations", param: "city" },
};

const CHECK_TEXT = "Check what you typed and try again";
const FAILED = "Search isn't working right now, please try again";

type SearchData = { by: SearchBy; q: string; results: SearchResult[]; error: string | null };

function isSearchBy(value: string | null): value is SearchBy {
  return value !== null && Object.hasOwn(ENDPOINTS, value);
}

/**
 * ?by= picks the list (anything unknown is shop) and ?q= narrows it; blank text asks for
 * the whole list. A failed search comes back as a message rather than an error page, so
 * the search bar stays usable.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<SearchData> {
  const params = new URL(request.url).searchParams;
  const asked = params.get("by");
  const by = isSearchBy(asked) ? asked : "shop";
  const q = params.get("q")?.trim() ?? "";

  const { path, param } = ENDPOINTS[by];
  const query = q ? `?${new URLSearchParams({ [param]: q })}` : "";

  let res: Response;
  try {
    res = await fetch(`${process.env.API_URL}${path}${query}`);
  } catch {
    return { by, q, results: [], error: FAILED };
  }

  if (!res.ok) {
    return { by, q, results: [], error: res.status === 422 ? CHECK_TEXT : FAILED };
  }
  const results: SearchResult[] = await res.json();
  return { by, q, results, error: null };
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Search" }];
}

export default function SearchRoute() {
  return <Search />;
}
