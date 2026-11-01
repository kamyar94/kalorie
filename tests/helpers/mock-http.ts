// Copied from the Lingo project (its own test helper).
// Small HTTP servers on 127.0.0.1 for tests: a provider mock that records requests and answers
// from a handler, and a forward proxy that records what passes through it.
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

export type MockReply = {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  /** Wait this long before answering (timeouts). */
  delayMs?: number;
};

export type MockServer = {
  url: string;
  requests: RecordedRequest[];
  reply: (handler: (request: RecordedRequest) => MockReply) => void;
  close: () => Promise<void>;
};

const listen = (server: http.Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

const close = (server: http.Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

export const startMockServer = async (): Promise<MockServer> => {
  const requests: RecordedRequest[] = [];
  let handler: (request: RecordedRequest) => MockReply = () => ({
    status: 500,
    json: { error: "no handler" },
  });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // keep the raw text
      }
      const recorded = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      const reply = handler(recorded);
      const payload = reply.text ?? (reply.json === undefined ? "" : JSON.stringify(reply.json));
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(reply.status ?? 200, {
          "content-type": reply.text ? "text/plain" : "application/json",
          ...reply.headers,
        });
        res.end(payload);
      }, reply.delayMs ?? 0);
    });
  });

  const url = await listen(server);
  return {
    url,
    requests,
    reply: (next) => {
      handler = next;
    },
    close: () => close(server),
  };
};

export type ForwardProxy = {
  url: string;
  /** Targets seen: absolute URLs for plain HTTP, host:port for CONNECT tunnels. */
  seen: string[];
  close: () => Promise<void>;
};

/** An HTTP forward proxy (absolute-form requests and CONNECT tunnels), like Squid in the stack. */
export const startForwardProxy = async (): Promise<ForwardProxy> => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? "");
    const target = new URL(req.url ?? "");
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on("connect", (req, socket, head) => {
    seen.push(req.url ?? "");
    const [host, port] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  const url = await listen(server);
  return { url, seen, close: () => close(server) };
};
