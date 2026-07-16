import { API_BASE_URL, API_V1_PREFIX, del, get, getAccessToken, post, put } from "@/service/base";
import type { PageQuery, PageResult } from "@/service/base";
import type {
  CreatePlanPayload,
  PlanAgentsResponse,
  PlanChatRequest,
  PlanDetail,
  PlanItem,
  PlanSseEvent,
  UpdatePlanPayload,
} from "./types";

const PLAN_CHAT = `${API_V1_PREFIX}/plan`;
const PLANS = `${API_V1_PREFIX}/plans`;

function parseSseChunk(buffer: string): { events: PlanSseEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: PlanSseEvent[] = [];

  for (const part of parts) {
    for (const line of part.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        events.push(JSON.parse(line.slice(6)) as PlanSseEvent);
      } catch {
        // ignore malformed frames
      }
    }
  }

  return { events, rest };
}

/** 行程规划 · CRUD + 智能体对话 */
export const planService = {
  /** GET /api/v1/plans — 行程列表 */
  listPlans(query?: PageQuery) {
    return get<PageResult<PlanItem>>(PLANS, { params: query });
  },

  /** GET /api/v1/plans/:id — 行程详情 */
  getPlan(id: string) {
    return get<PlanDetail>(`${PLANS}/${id}`);
  },

  /** POST /api/v1/plans — 创建行程 */
  createPlan(payload: CreatePlanPayload) {
    return post<PlanDetail>(PLANS, payload);
  },

  /** PUT /api/v1/plans/:id — 更新行程 */
  updatePlan(id: string, payload: UpdatePlanPayload) {
    return put<PlanDetail>(`${PLANS}/${id}`, payload);
  },

  /** DELETE /api/v1/plans/:id — 删除行程 */
  deletePlan(id: string) {
    return del<void>(`${PLANS}/${id}`);
  },

  /** GET /api/v1/plan/agents */
  listAgents() {
    return fetch(`${API_BASE_URL}${PLAN_CHAT}/agents`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {}),
      },
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to load agents (${res.status})`);
      }
      return (await res.json()) as PlanAgentsResponse;
    });
  },

  /**
   * POST /api/v1/plan/chat — SSE stream.
   * Yields parsed events until `done` / abort / error.
   */
  async *streamChat(
    payload: PlanChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<PlanSseEvent, void, unknown> {
    const res = await fetch(`${API_BASE_URL}${PLAN_CHAT}/chat`, {
      method: "POST",
      credentials: "include",
      signal,
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...(getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {}),
      },
      body: JSON.stringify({
        messages: payload.messages,
        agentId: payload.agentId,
        model: payload.model,
        threadId: payload.threadId,
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || `Chat failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        yield event;
        if (event.type === "done") return;
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseChunk(`${buffer}\n\n`);
      for (const event of parsed.events) {
        yield event;
      }
    }
  },
};
