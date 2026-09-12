import { assertEquals } from "@std/assert";
import { isApi, serveStatic } from "../static.ts";

Deno.test("isApi: only /api, /api/* and /healthz", () => {
  assertEquals(isApi("/api"), true);
  assertEquals(isApi("/api/round"), true);
  assertEquals(isApi("/healthz"), true);
  assertEquals(isApi("/apix"), false);
  assertEquals(isApi("/"), false);
});

Deno.test("serveStatic: files, immutable assets, and the SPA fallback", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/assets`);
  await Deno.writeTextFile(`${root}/index.html`, "<!doctype html><title>shell</title>");
  await Deno.writeTextFile(`${root}/assets/app-abc.js`, "1");
  const asset = await serveStatic(new Request("http://x/assets/app-abc.js"), root);
  assertEquals(asset.status, 200);
  assertEquals(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
  await asset.body?.cancel();
  const shell = await serveStatic(new Request("http://x/"), root);
  assertEquals(shell.headers.get("cache-control"), "no-cache");
  await shell.body?.cancel();
  const deep = await serveStatic(new Request("http://x/project/3"), root);
  assertEquals(deep.status, 200);
  assertEquals(await deep.text(), "<!doctype html><title>shell</title>");
});
