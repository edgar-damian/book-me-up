import type { Route } from "./+types/establishment";
import { EstablishmentPage, type Establishment } from "../pages/EstablishmentPage";


export async function loader({ params }: Route.LoaderArgs) {
  const res = await fetch(`${process.env.API_URL}/establishments/${params.slug}`);
  if (!res.ok) throw new Response("Not found", { status: res.status });
  const establishment: Establishment = await res.json();
  return establishment;
}


export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Shop not found" }];
  return [
    { title: `${loaderData.name}` },
    { name: "description", content: loaderData.description },
  ];
}


export default function Establishment({ loaderData }: Route.ComponentProps) {
  return <EstablishmentPage establishment={loaderData} />;
}
