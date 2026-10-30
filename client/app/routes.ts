import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("shops/:slug", "routes/establishmentPage.tsx"),
  route("view-services/:slug", "routes/workerPage.tsx"),
  route("book-with/:establishmentId/:workerId/:serviceId", "routes/bookingFlow.tsx"),
  route("waitlist", "routes/waitlist.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("signup", "routes/signup.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
] satisfies RouteConfig;
