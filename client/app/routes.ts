import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("shops/:slug", "routes/establishment.tsx"),
] satisfies RouteConfig;
