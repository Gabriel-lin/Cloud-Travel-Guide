export type RouteItem = {
  id: string;
  title: string;
  region: string;
  summary: string;
  coverUrl?: string;
  tags?: string[];
};

export type RouteDetail = RouteItem & {
  description?: string;
  waypoints?: Array<{
    name: string;
    lat: number;
    lon: number;
  }>;
};

export type CreateRoutePayload = Pick<
  RouteItem,
  "title" | "region" | "summary" | "coverUrl" | "tags"
>;

export type UpdateRoutePayload = Partial<CreateRoutePayload>;
