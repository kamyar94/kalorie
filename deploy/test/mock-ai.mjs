// Stand-in for the Google Gemini API in the stack test. Runs in the "mock" container: it starts the
// integration mocks of the test helpers (tests/helpers/mock-integrations.ts, copied next to this
// file) on a private port and puts a TLS front on port 443 that answers as
// generativelanguage.googleapis.com, using the self-signed certificate Test-Stack.ps1 made. The
// egress proxy's name lookup points that host at this container, so the app and the worker call it
// through the proxy exactly as they would call Google. Each request is logged as method and path
// only (never headers or bodies), which lets the test see that the traffic arrived.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

import { startIntegrationMocks } from "./mock-integrations.ts";

const mocks = await startIntegrationMocks();
const upstream = new URL(mocks.url);

const server = https.createServer(
  {
    key: fs.readFileSync("/test/mock-key.pem"),
    cert: fs.readFileSync("/test/mock-cert.pem"),
  },
  (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "/").split("?")[0];
      console.log(`mock-ai ${req.method} ${path}`);
      const forward = http.request(
        {
          host: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: `/google${req.url}`,
          headers: {
            "content-type": req.headers["content-type"] ?? "application/json",
            "content-length": String(body.length),
          },
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, {
            "content-type": reply.headers["content-type"] ?? "application/json",
          });
          reply.pipe(res);
        },
      );
      forward.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      forward.end(body);
    });
  },
);

server.listen(443, "0.0.0.0", () => console.log("mock-ai listening on 443"));
const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
