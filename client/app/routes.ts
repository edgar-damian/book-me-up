import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("establishments/:slug", "routes/establishment.tsx"),
  route("book-with/:slug","routes/bookWith.tsx"),
  route("book/:workerSlug/:serviceId", "routes/book.tsx"),
  route("api/booking/availability", "routes/bookingAvailability.ts"),
] satisfies RouteConfig;
