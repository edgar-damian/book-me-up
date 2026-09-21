import type { Route } from "./+types/home";
import LandingPage from "../pages/LandingPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Book-Me-Up" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {
  return <LandingPage />;
}
