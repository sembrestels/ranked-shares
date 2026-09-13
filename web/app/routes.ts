import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/round.tsx"),
  route("project/:id", "routes/project.tsx"),
  route("proposals", "routes/proposals.tsx"),
  route("vote", "routes/vote.tsx"),
  route("liquidity", "routes/liquidity.tsx"),
  route("submit", "routes/submit.tsx"),
  route("setup", "routes/setup.tsx"),
] satisfies RouteConfig;
