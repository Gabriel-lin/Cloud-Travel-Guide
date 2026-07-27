export type PlanAgentKind = "builtin" | "external";

export type PlanAgentStatus = "ready" | "coming_soon";

export type PlanAgent = {
  id: string;
  kind: PlanAgentKind;
  name: string;
  description: string;
  defaultModel: string;
  enabled: boolean;
  status: PlanAgentStatus;
};

export type PlanModel = {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  description: string;
  configured: boolean;
};

export type PlanAgentsResponse = {
  agents: PlanAgent[];
  models: PlanModel[];
  defaultAgentId: string;
};

export type PlanChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type PlanChatRequest = {
  messages: PlanChatMessage[];
  agentId: string;
  model?: string;
  threadId?: string;
  planId?: string;
};

export type PlanSseEvent =
  | {
      type: "start";
      agentId: string;
      model: string;
      threadId?: string | null;
      planId?: string | null;
    }
  | { type: "delta"; text: string }
  | {
      type: "tool_start";
      toolCallId?: string;
      name: string;
      input?: unknown;
    }
  | {
      type: "tool_result";
      toolCallId?: string;
      name: string;
      outputPreview?: string;
    }
  | {
      type: "tool_error";
      toolCallId?: string;
      name: string;
      message: string;
    }
  | {
      type: "job_progress";
      jobId: string;
      status: string;
      message?: string | null;
      percent?: number | null;
    }
  | {
      type: "plan_updated";
      planId: string;
      summary?: string;
    }
  | { type: "error"; message: string }
  | { type: "done" };

export type WorkspaceFilePayload = {
  path: string;
  filename: string;
  mimeType: string;
  data: string;
};

/** 用户行程实体 — 供列表/详情/编辑页使用 */
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
  itinerary?: Record<string, unknown> | null;
};

export type CreatePlanPayload = {
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  destinations?: PlanDetail["destinations"];
};

export type UpdatePlanPayload = Partial<CreatePlanPayload>;
