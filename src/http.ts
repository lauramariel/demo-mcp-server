import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.warn(
    "[demo-crm-mcp-server] MCP_API_KEY is not set — the /mcp endpoint is unauthenticated. " +
      "Set MCP_API_KEY before exposing this beyond localhost."
  );
}

const app = express();
app.use(express.json());

function checkAuth(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) return next();
  const header = req.header("authorization");
  if (header === `Bearer ${API_KEY}`) return next();
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// One transport per active MCP session, keyed by the session ID the
// transport itself generates on `initialize`.
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", checkAuth, async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  let transport: StreamableHTTPServerTransport | undefined = sessionId
    ? transports.get(sessionId)
    : undefined;

  if (!transport) {
    if (sessionId || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });

    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };

    const server = buildServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req: Request, res: Response) {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
}

app.get("/mcp", checkAuth, handleSessionRequest);
app.delete("/mcp", checkAuth, handleSessionRequest);

app.listen(PORT, () => {
  console.log(`demo-crm-mcp-server listening on http://localhost:${PORT}/mcp (Streamable HTTP)`);
});
