/** The built SPA from build/client with the SPA fallback, and the split
 * between API paths and page paths. Same shape as thedao-rfps/web/server.ts. */
import { serveDir } from "@std/http/file-server";

export const isApi = (pathname: string): boolean =>
  pathname === "/healthz" || pathname === "/api" || pathname.startsWith("/api/");

/** Vite names assets by content hash, so they cache for good; the HTML shell
 * must revalidate on every load or a browser keeps the previous deploy. */
function withCaching(res: Response, pathname: string): Response {
  if (res.status !== 200) return res;
  const html = res.headers.get("Content-Type")?.includes("text/html");
  const value = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : html
    ? "no-cache"
    : "public, max-age=300";
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function serveStatic(req: Request, root: string): Promise<Response> {
  const { pathname } = new URL(req.url);
  const res = await serveDir(req, { fsRoot: root, quiet: true });
  if (res.status !== 404) return withCaching(res, pathname);
  await res.body?.cancel();
  const fallback = await serveDir(new Request(new URL("/index.html", req.url), req), {
    fsRoot: root,
    quiet: true,
  });
  return withCaching(fallback, pathname);
}
