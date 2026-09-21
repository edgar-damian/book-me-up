import type { Route } from "./+types/workerPage";
import { WorkerPage } from "../pages/WorkerPage";
import type { WorkerLandingPage } from "~/models/workerPage";


export async function loader({ params }: Route.LoaderArgs) {
  const res = await fetch(`${process.env.API_URL}/workers/${params.slug}`);
  if (!res.ok) throw new Response("Not found", { status: res.status });
  const workerLandingPage: WorkerLandingPage = await res.json();
  return workerLandingPage;
}


export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Worker not found" }];
  return [
    { title: `${loaderData.first_name} ${loaderData.last_name}` },
    { name: "description", content: loaderData.bio },
  ];
}


export default function Establishment({ loaderData }: Route.ComponentProps) {
  return <WorkerPage worker={loaderData} />;
}
