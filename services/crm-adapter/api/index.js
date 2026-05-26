// Vercel serverless entrypoint for the Express app. Unlike src/server.js (used
// for local dev), this exports the app as a request handler WITHOUT calling
// listen() — Vercel invokes it per request. All routes are funneled here by the
// catch-all rewrite in vercel.json, so Express's own routing still applies.
const { createApp } = require("../src/app");

module.exports = createApp();
