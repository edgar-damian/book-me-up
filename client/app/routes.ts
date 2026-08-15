import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("establishments/:slug", "routes/establishment.tsx"),
  route("book-with/:slug","routes/bookWith.tsx")
] satisfies RouteConfig;
