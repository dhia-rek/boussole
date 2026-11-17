/**
 * LangChain Deep Agents API (tenant-scoped).
 *
 * POST /api/agents/application/:jobId   start the application agent → 202 { runId, run }
 * POST /api/agents/learn                start the preference learner → 202 { runId, run }
 * GET  /api/agents/runs?jobId=&limit=   list runs (newest first)
 * GET  /api/agents/runs/:runId          one run
 * POST /api/agents/runs/:runId/cancel   cancel a run
 * GET  /api/agents/runs/:runId/events   SSE: stored events, then live ones
 * GET  /api/agents/memory               learned preferences file
 */
import { badRequest } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import {
  cancelAgentRun,
  getAgentMemory,
  getAgentRun,
  listAgentRuns,
  startApplicationRun,
  startLearnRun,
  subscribeToAgentRun,
} from "@server/services/agents";
import type { AgentRunEvent, AgentRunStreamMessage } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const agentsRouter = Router();

const idSchema = z.string().trim().min(1).max(255);
const jobParamsSchema = z.object({ jobId: idSchema });
const runParamsSchema = z.object({ runId: idSchema });
const listQuerySchema = z.object({
  jobId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function eventKey(event: AgentRunEvent): string {
  return `${event.at}|${event.type}|${event.agent}|${event.label}`;
}

agentsRouter.post(
  "/application/:jobId",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = jobParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
      return;
    }
    const run = await startApplicationRun(parsed.data.jobId);
    ok(res, { runId: run.id, run }, 202);
  }),
);

agentsRouter.post(
  "/learn",
  asyncRoute(async (_req: Request, res: Response) => {
    const run = await startLearnRun();
    ok(res, { runId: run.id, run }, 202);
  }),
);

agentsRouter.get(
  "/runs",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
      return;
    }
    ok(res, await listAgentRuns(parsed.data));
  }),
);

agentsRouter.get(
  "/runs/:runId",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = runParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
      return;
    }
    ok(res, await getAgentRun(parsed.data.runId));
  }),
);

agentsRouter.post(
  "/runs/:runId/cancel",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = runParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
      return;
    }
    ok(res, await cancelAgentRun(parsed.data.runId));
  }),
);

agentsRouter.get(
  "/runs/:runId/events",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = runParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      fail(res, badRequest(parsed.error.message, parsed.error.flatten()));
      return;
    }
    const runId = parsed.data.runId;
    // 404s (other tenants included) happen before the stream opens.
    await getAgentRun(runId);

    const sent = new Set<string>();
    const buffered: AgentRunStreamMessage[] = [];
    let replaying = true;
    let closed = false;

    const send = (message: AgentRunStreamMessage) => {
      if (closed) return;
      if (message.type === "event") {
        const key = eventKey(message.event);
        if (sent.has(key)) return;
        sent.add(key);
      }
      writeSseData(res, message);
      if (message.type === "run") {
        closed = true;
        res.end();
      }
    };

    // Subscribe before reading stored events so nothing falls in between.
    const unsubscribe = subscribeToAgentRun(runId, (message) => {
      if (replaying) buffered.push(message);
      else send(message);
    });

    setupSse(res, {
      cacheControl: "no-cache, no-transform",
      disableBuffering: true,
      flushHeaders: true,
    });

    const run = await getAgentRun(runId);
    for (const event of run.events) send({ type: "event", runId, event });
    replaying = false;
    for (const message of buffered.splice(0)) send(message);

    if (!unsubscribe) {
      // Not running in this process: the stored state is final.
      send({ type: "run", run });
      return;
    }

    const stopHeartbeat = startSseHeartbeat(res);
    req.on("close", () => {
      closed = true;
      stopHeartbeat();
      unsubscribe();
    });
    res.on("finish", () => {
      stopHeartbeat();
      unsubscribe();
    });
  }),
);

agentsRouter.get(
  "/memory",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, await getAgentMemory());
  }),
);
