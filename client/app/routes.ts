import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("shops/:slug", "routes/establishmentPage.tsx"),
  route("view-services/:slug", "routes/workerPage.tsx"),
  route("book-with/:establishmentId/:workerId/:serviceId", "routes/bookingFlow.tsx"),
] satisfies RouteConfig;
