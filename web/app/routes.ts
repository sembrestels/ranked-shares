import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/board.tsx"),
  route("submit", "routes/submit.tsx"),
  route("setup", "routes/setup.tsx"),
] satisfies RouteConfig;
