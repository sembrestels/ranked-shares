import { useState } from "react";
import { useParams } from "react-router";
import type { Route } from "./+types/project";
import { Pitch } from "../components/project/pitch";
import { ProjectSummary } from "../components/project/project-summary";
import { Notice, Skeleton } from "../components/ui";
import { useRound, useSwarm } from "../context/providers";
import { useProject } from "../hooks/use-snapshot";
import type { Attachment } from "../lib/api-types";
import { buildPool, projectFacts } from "../lib/build-chain";
import { projectMetaTags } from "../lib/meta";
import { errorMessage } from "../lib/proposals";
import { saveDownload } from "../lib/swarm";
import { downloadAttachment } from "../lib/private-proposals";

const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || "http://localhost:5174";

/** Build time only (prerender): the meta data for this project. */
export async function loader({ params }: Route.LoaderArgs) {
  const cfg = buildPool();
  if (!cfg) return null;
  try {
    return await projectFacts(Number(params.id), cfg);
  } catch {
    return null;
  }
}
/** In the browser the page reads the API; nothing to load. */
export async function clientLoader() {
  return null;
}
clientLoader.hydrate = false as const;

export function meta({ data, params }: Route.MetaArgs) {
  const id = /^\d+$/.test(params.id ?? "") ? Number(params.id) : 0;
  return projectMetaTags(data ?? null, id, SITE_URL);
}

export default function ProjectPage() {
  const { id: raw } = useParams();
  const id = /^\d+$/.test(raw ?? "") ? Number(raw) : -1;
  const { pool } = useRound();
  const { client } = useSwarm();
  const project = useProject(id);
  const [downloadError, setDownloadError] = useState<string>();

  async function download(file: Attachment) {
    if (!client) {
      setDownloadError("Swarm is still connecting; try again in a moment.");
      return;
    }
    try {
      saveDownload(await downloadAttachment(client, file), file.name);
    } catch (e) {
      setDownloadError(errorMessage(e));
    }
  }

  if (id < 0) return <Notice error>This project id is not valid.</Notice>;
  if (!pool) return <Notice>Choose a round above to see this project.</Notice>;
  if (!project.data) {
    return project.isError ? <Notice error>Could not load the project: {errorMessage(project.error)}</Notice> : <Skeleton lines={6} />;
  }
  return (
    <>
      <ProjectSummary response={project.data} />
      <Pitch response={project.data} onRetry={() => project.refetch()} onDownload={download} />
      {downloadError && <Notice error>{downloadError}</Notice>}
    </>
  );
}
