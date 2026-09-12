import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/board.tsx"),
  route("submit", "routes/submit.tsx"),
  route("setup", "routes/setup.tsx"),
  route("vote", "routes/vote.tsx"),
  route("liquidity", "routes/liquidity.tsx"),
] satisfies RouteConfig;
