export type PlanItem = {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string;
  destinationCount: number;
  updatedAt: string;
};

export type PlanDetail = PlanItem & {
  description?: string;
  destinations?: Array<{
    name: string;
    lat: number;
    lon: number;
    stayDays?: number;
  }>;
};

export type CreatePlanPayload = {
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type UpdatePlanPayload = Partial<CreatePlanPayload>;
