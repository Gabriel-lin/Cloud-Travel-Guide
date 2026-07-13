import { notFound } from "next/navigation";

import { RouteExperience } from "@/components/routes/experience/RouteExperience";
import {
  ROUTE_SLUGS,
  getRouteConfig,
} from "@/components/routes/experience/route-configs";

export function generateStaticParams() {
  return ROUTE_SLUGS.map((slug) => ({ slug }));
}

export default async function RouteExperiencePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const config = getRouteConfig(slug);
  if (!config) notFound();

  return <RouteExperience config={config} />;
}
