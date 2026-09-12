import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const server = require("react-dom/server.node");
export const renderToPipeableStream = server.renderToPipeableStream;
export const renderToString = server.renderToString;
export const renderToStaticMarkup = server.renderToStaticMarkup;
