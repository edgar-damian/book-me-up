import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult, SearchResultShop, SearchResultWorker } from "~/models/search";
import SearchRoute, { loader } from "~/routes/search";
import { SearchBar } from "~/widgets/Search/searchBar";
import { expectHeadingOutline } from "./helpers";

const REGULAR: SearchResultShop = {
  kind: "shop",
  slug: "regular-cutz",
  name: "Regular Cutz",
  address: "1 Park Avenue",
  city: "Twin Peaks",
  state: "CA",
  zip: "91302",
  images: [],
};
const KRUSTY: SearchResultShop = {
  ...REGULAR,
  slug: "krusty-fadez",
  name: "Krusty Fadez",
  address: "831 Bottom Feeder Lane",
  city: "Bikini Bottom",
  state: "MH",
  zip: "96970",
};
const at = (shop: SearchResultShop) => ({
  slug: shop.slug,
  name: shop.name,
  city: shop.city,
  state: shop.state,
});
const BENSON: SearchResultWorker = {
  kind: "worker",
  slug: "benson-dunwoody",
  first_name: "Benson",
  last_name: "Dunwoody",
  image: null,
  shops: [at(REGULAR)],
};
const SKIPS: SearchResultWorker = {
  ...BENSON,
  slug: "skips-yeti",
  first_name: "Skips",
  last_name: "Yeti",
  shops: [at(KRUSTY), at(REGULAR)],
};

type Answer = { results?: SearchResult[]; error?: string | null };

/**
 * The real route with a stand-in loader. `answer` gets each request's ?by and ?q; every
 * request is recorded as "by:q".
 */
async function renderSearch(answer: (by: string, q: string) => Answer | Promise<Answer> = () => ({})) {
  const asked: string[] = [];
  const stubLoader = async ({ request }: { request: Request }) => {
    const params = new URL(request.url).searchParams;
    const by = params.get("by") ?? "shop";
    const q = params.get("q") ?? "";
    asked.push(`${by}:${q}`);
    return { by, q, results: [REGULAR], error: null, ...(await answer(by, q)) };
  };
  const Stub = createRoutesStub([{ path: "/search", Component: SearchRoute, loader: stubLoader }]);
  render(<Stub initialEntries={["/search"]} />);
  await screen.findByRole("heading", { level: 1 });
  return { user: userEvent.setup(), asked };
}

const chip = (name: string) => screen.getByRole("radio", { name });

describe("search page", () => {
  it("has one h1 and a clean heading outline", async () => {
    await renderSearch();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Find your next appointment",
    );
    expectHeadingOutline();
  });

  it("starts on Shop", async () => {
    await renderSearch();

    expect(chip("Shop")).toBeChecked();
    expect(screen.getByLabelText("Search shops by name")).toHaveAttribute("placeholder", "Shop name");
  });

  it("relabels the field when Location is picked", async () => {
    const { user } = await renderSearch();

    await user.click(chip("Location"));

    expect(chip("Location")).toBeChecked();
    expect(chip("Shop")).not.toBeChecked();
    expect(screen.getByLabelText("Search by city")).toHaveAttribute("placeholder", "City");
  });

  it("shows a clear button only once something is typed, and it empties the field", async () => {
    const { user } = await renderSearch();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    const field = screen.getByLabelText("Search shops by name");
    await user.type(field, "Boise");
    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });
});

describe("search results", () => {
  it("shows the loader's shops on the first visit", async () => {
    await renderSearch();

    expect(screen.getByRole("status")).toHaveTextContent("1 result");
    expect(screen.getByRole("link", { name: "Regular Cutz" })).toHaveAttribute(
      "href",
      "/shops/regular-cutz",
    );
    expect(screen.getByText(/1 Park Avenue/)).toHaveTextContent("1 Park AvenueTwin Peaks, CA 91302");
  });

  it("loads the picked chip with the typed text and shows worker cards", async () => {
    const { user, asked } = await renderSearch((by) =>
      by === "provider" ? { results: [BENSON] } : {},
    );

    await user.type(screen.getByLabelText("Search shops by name"), "benson");
    await user.click(chip("Service Provider"));

    const link = await screen.findByRole("link", { name: "Benson Dunwoody" });
    expect(asked).toContain("provider:benson");
    expect(link).toHaveAttribute("href", "/view-services/benson-dunwoody");
    expect(screen.getByText(/^at/)).toHaveTextContent("at Regular Cutz");
    expect(screen.getByRole("status")).toHaveTextContent('1 result for "benson"');
  });

  it("lists every shop a worker works at", async () => {
    const { user } = await renderSearch((by) => (by === "provider" ? { results: [SKIPS] } : {}));

    await user.click(chip("Service Provider"));

    await screen.findByRole("link", { name: "Skips Yeti" });
    expect(screen.getByText(/^at/)).toHaveTextContent("at Krusty Fadez, Regular Cutz");
  });

  it("groups the location list under each city", async () => {
    const skipsInBikiniBottom = { ...SKIPS, shops: [at(KRUSTY)] };
    const { user } = await renderSearch((by) =>
      by === "location" ? { results: [KRUSTY, skipsInBikiniBottom, BENSON, REGULAR] } : {},
    );

    await user.click(chip("Location"));

    const bikini = await screen.findByRole("heading", { level: 2, name: "Bikini Bottom, MH" });
    const twinPeaks = screen.getByRole("heading", { level: 2, name: "Twin Peaks, CA" });
    const names = (heading: HTMLElement) =>
      within(heading.parentElement!).getAllByRole("link").map((link) => link.textContent);
    expect(names(bikini)).toEqual(["Krusty Fadez", "Skips Yeti"]);
    expect(names(twinPeaks)).toEqual(["Benson Dunwoody", "Regular Cutz"]);
    expectHeadingOutline();
  });

  it("puts a city spelled in two cases under one heading", async () => {
    const boise = { ...REGULAR, city: "Boise", state: "ID" };
    const { user } = await renderSearch((by) =>
      by === "location"
        ? { results: [{ ...boise, slug: "alley-cuts", name: "Alley Cuts", state: "Id" }, boise] }
        : {},
    );

    await user.click(chip("Location"));

    await screen.findByRole("heading", { level: 2, name: "Boise, Id" });
    expect(screen.getAllByRole("heading", { level: 2, name: /boise/i })).toHaveLength(1);
  });

  it("says when nothing matched", async () => {
    const { user } = await renderSearch((_, q) => (q ? { results: [] } : {}));

    await user.type(screen.getByLabelText("Search shops by name"), "New York{Enter}");

    expect(await screen.findByRole("heading", { name: 'No results for "New York"' })).toBeInTheDocument();
  });

  it("shows the loader's message when a search fails", async () => {
    const { user } = await renderSearch((_, q) =>
      q ? { results: [], error: "Search isn't working right now, please try again" } : {},
    );

    await user.type(screen.getByLabelText("Search shops by name"), "cutz{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search isn't working right now, please try again",
    );
  });

  it("marks the Search button busy until the results arrive", async () => {
    let finish: () => void = () => {};
    const { user } = await renderSearch((_, q) =>
      q ? new Promise<Answer>((resolve) => (finish = () => resolve({ results: [KRUSTY] }))) : {},
    );

    await user.type(screen.getByLabelText("Search shops by name"), "krusty{Enter}");

    const button = screen.getByRole("button", { name: "Searching…" });
    expect(button).toHaveAttribute("aria-busy", "true");

    finish();
    await screen.findByRole("link", { name: "Krusty Fadez" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-busy", "false"));
  });

  it("shows a placeholder instead of a missing photo", async () => {
    await renderSearch(() => ({ results: [REGULAR, BENSON] }));

    expect(document.querySelector("img")).toBeNull();
  });
});

describe("search bar", () => {
  it("searches again right away when a different chip is picked", async () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Search shops by name"), "benson");
    await user.click(screen.getByRole("radio", { name: "Service Provider" }));

    expect(onSearch).toHaveBeenLastCalledWith("provider", "benson");
  });

  it("searches with the current chip and text on Enter", async () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Location" }));
    await user.type(screen.getByLabelText("Search by city"), "Bikini Bottom{Enter}");

    expect(onSearch).toHaveBeenLastCalledWith("location", "Bikini Bottom");
  });
});

describe("search loader", () => {
  const API_URL = "http://api.test";
  const SHOP = {
    kind: "shop",
    slug: "regular-cutz",
    name: "Regular Cutz",
    address: "1 Park Avenue",
    city: "Twin Peaks",
    state: "CA",
    zip: "91302",
    images: [],
  };

  beforeEach(() => vi.stubEnv("API_URL", API_URL));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** fetch answering every call with one status and JSON body. */
  function stubApi(status: number, body: unknown = []) {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(body), { status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const load = (search = "") =>
    loader({ request: new Request(`http://localhost/search${search}`) } as Parameters<
      typeof loader
    >[0]);

  const calledUrl = (fetchMock: ReturnType<typeof stubApi>) => String(fetchMock.mock.calls[0][0]);

  it("asks for every shop when nothing is chosen or typed", async () => {
    const fetchMock = stubApi(200, [SHOP]);

    expect(await load()).toEqual({ by: "shop", q: "", results: [SHOP], error: null });
    expect(calledUrl(fetchMock)).toBe(`${API_URL}/search/shops`);
  });

  it.each([
    ["?by=shop&q=cutz", "/search/shops?name=cutz"],
    ["?by=provider&q=benson", "/search/workers?name=benson"],
    ["?by=location&q=Bikini%20Bottom", "/search/locations?city=Bikini+Bottom"],
  ])("sends %s to %s", async (search, path) => {
    const fetchMock = stubApi(200);

    await load(search);

    expect(calledUrl(fetchMock)).toBe(`${API_URL}${path}`);
  });

  it("asks for the whole list when the text is only spaces", async () => {
    const fetchMock = stubApi(200);

    expect((await load("?by=provider&q=%20%20")).q).toBe("");
    expect(calledUrl(fetchMock)).toBe(`${API_URL}/search/workers`);
  });

  it("treats an unknown chip as shop", async () => {
    const fetchMock = stubApi(200);

    expect((await load("?by=toString&q=fade")).by).toBe("shop");
    expect(calledUrl(fetchMock)).toBe(`${API_URL}/search/shops?name=fade`);
  });

  it("keeps & and % inside the search text", async () => {
    const fetchMock = stubApi(200);

    await load(`?q=${encodeURIComponent("A&B 50%")}`);

    expect(calledUrl(fetchMock)).toBe(`${API_URL}/search/shops?name=A%26B+50%25`);
  });

  it.each([
    ["the API rejects the text", 422, "Check what you typed and try again"],
    ["the API is down", 503, "Search isn't working right now, please try again"],
  ])("gives a message instead of an error page when %s", async (_, status, error) => {
    stubApi(status, { detail: "nope" });

    expect(await load("?q=cutz")).toEqual({ by: "shop", q: "cutz", results: [], error });
  });

  it("gives a message when the API can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")));

    expect((await load()).error).toBe("Search isn't working right now, please try again");
  });
});
