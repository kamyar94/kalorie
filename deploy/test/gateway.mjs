// Stand-in for the Cloudflare tunnel connector in the stack test. The real connector passes
// traffic from Cloudflare to app:3000 over the internal tunnel network; this one passes traffic
// from the one port that the test publishes on 127.0.0.1 to app:3000 the same way, byte for byte,
// so the app sees the browser's own Host and Origin headers. Docker cannot publish a port of a
// container that sits only on internal networks, which is why the app itself publishes nothing.
import net from "node:net";

const server = net.createServer((client) => {
  const upstream = net.connect({ host: "app", port: 3000 });
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
  client.on("close", close);
  upstream.on("close", close);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.listen(3000, "0.0.0.0", () => console.log("gateway listening on 3000"));
const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
