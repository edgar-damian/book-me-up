import type { Route } from "./+types/search";
import { Search } from "../pages/Search";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Search" }];
}

export default function SearchRoute() {
  return <Search />;
}
