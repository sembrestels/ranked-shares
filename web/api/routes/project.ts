import { Hono } from "hono";
import { HttpError } from "../app.ts";
import type { Deps } from "../deps.ts";
import { minBlockFrom, poolFrom } from "./round.ts";

export function projectRoutes(deps: Deps) {
  const r = new Hono();
  r.get("/:id", async (c) => {
    const raw = c.req.param("id");
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id)) throw new HttpError(400, "id must be a non-negative integer");
    const pool = poolFrom(c.req.query("pool"), deps.config);
    const { snapshot } = await deps.snapshots.get(pool, minBlockFrom(c.req.query("after")));
    const project = snapshot.projects[id];
    if (!project) throw new HttpError(404, "unknown project");
    const resolved = await deps.content.get(project.contentRef);
    const { pool: p, kind, block, at, token, phase, finality, stage } = snapshot;
    return c.json({
      project,
      round: { pool: p, kind, block, at, token, phase, finality, stage },
      contentStatus: resolved.status,
      content: resolved.content,
      reason: resolved.reason,
    });
  });
  return r;
}
