import type { Route } from "./+types/bookWith";
import { BookWith, type Barber } from "../pages/BookWith";

export async function loader({ params }: Route.LoaderArgs) {
  const res = await fetch(`${process.env.API_URL}/book-with/${params.slug}`);
  if (!res.ok) throw new Response("Not found", { status: res.status });
  const barber: Barber = await res.json();
  return barber;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Barber not found · book-me-up" }];
  return [
    {
      title: `${loaderData.first_name} ${loaderData.last_name} · book-me-up`,
    },
    { name: "description", content: loaderData.bio },
  ];
}

export default function BookWithRoute({ loaderData }: Route.ComponentProps) {
  return <BookWith barber={loaderData} />;
}
