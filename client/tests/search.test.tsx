import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchRoute, { loader } from "~/routes/search";
import { SearchBar } from "~/widgets/Search/searchBar";
import { expectHeadingOutline } from "./helpers";

function renderSearch() {
  const Stub = createRoutesStub([{ path: "/search", Component: SearchRoute }]);
  render(<Stub initialEntries={["/search"]} />);
  return userEvent.setup();
}

const chip = (name: string) => screen.getByRole("radio", { name });

describe("search page", () => {
  it("has one h1 and a clean heading outline", () => {
    renderSearch();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Find your next appointment",
    );
    expectHeadingOutline();
  });

  it("starts on Shop", () => {
    renderSearch();

    expect(chip("Shop")).toBeChecked();
    expect(screen.getByLabelText("Search shops by name")).toHaveAttribute("placeholder", "Shop name");
  });

  it("relabels the field when Location is picked", async () => {
    const user = renderSearch();

    await user.click(chip("Location"));

    expect(chip("Location")).toBeChecked();
    expect(chip("Shop")).not.toBeChecked();
    expect(screen.getByLabelText("Search by city")).toHaveAttribute("placeholder", "City");
  });

  it("shows a clear button only once something is typed, and it empties the field", async () => {
    const user = renderSearch();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    const field = screen.getByLabelText("Search shops by name");
    await user.type(field, "Boise");
    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
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
