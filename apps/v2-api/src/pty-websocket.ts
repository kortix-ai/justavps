import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';

import WebSocket, { WebSocketServer } from 'ws';

import type { ServerType } from '@hono/node-server';
import type { AppConfig } from './config.js';
import { machineClient } from './app.js';

type UpgradeContext = {
  machineId: string;
  sessionId: string;
  cols: number;
  rows: number;
};

type MachineClientResult = Awaited<ReturnType<typeof machineClient>>;

type PtySession = {
  key: string;
  machineId: string;
  sessionId: string;
  latestSize: { cols: number; rows: number };
  clients: Set<WebSocket>;
  pendingInput: string[];
  buffer: string;
  ptyWs: WebSocket | null;
  controlWs: WebSocket | null;
  ptyOpen: boolean;
  starting: boolean;
  closed: boolean;
  resolvedClient: MachineClientResult | null;
};

const PTY_BUFFER_LIMIT = 128_000;

function allowedToken(config: AppConfig, token: string | null) {
  if (!config.adminToken) return true;
  if (!token) return false;
  return config.adminToken.split(',').map((entry) => entry.trim()).filter(Boolean).includes(token);
}

function writeUpgradeError(socket: Socket, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeSessionId(value: string | null) {
  const clean = (value || 'main').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 96);
  return clean || 'main';
}

function sendText(ws: WebSocket, value: string) {
  if (ws.readyState === WebSocket.OPEN) ws.send(value);
}

function sendPtyInput(ws: WebSocket | null, value: string) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(Buffer.from(value, 'utf8'));
}

function messageToString(data: WebSocket.RawData) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export function registerMachinePtyWebSocket(server: ServerType, config: AppConfig) {
  const httpServer = server as Server;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const contexts = new WeakMap<WebSocket, UpgradeContext>();
  const sessions = new Map<string, PtySession>();

  const sessionKey = (machineId: string, sessionId: string) => `${machineId}:${sessionId}`;

  function appendBuffer(session: PtySession, value: string) {
    session.buffer += value;
    if (session.buffer.length > PTY_BUFFER_LIMIT) session.buffer = session.buffer.slice(-PTY_BUFFER_LIMIT);
  }

  function broadcast(session: PtySession, value: string, store = true) {
    if (store) appendBuffer(session, value);
    for (const client of session.clients) sendText(client, value);
  }

  function closeSocket(ws: WebSocket | null, code = 1000, reason = 'closed') {
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close(code, reason);
  }

  function terminateSession(session: PtySession, reason?: string, code = 1000) {
    if (session.closed) return;
    session.closed = true;
    if (reason) broadcast(session, reason, true);
    closeSocket(session.ptyWs, code, 'terminal session closed');
    closeSocket(session.controlWs, code, 'terminal session closed');
    for (const client of session.clients) closeSocket(client, code, 'terminal session closed');
    session.clients.clear();
    sessions.delete(session.key);
  }

  function createSession(ctx: UpgradeContext): PtySession {
    return {
      key: sessionKey(ctx.machineId, ctx.sessionId),
      machineId: ctx.machineId,
      sessionId: ctx.sessionId,
      latestSize: { cols: ctx.cols, rows: ctx.rows },
      clients: new Set(),
      pendingInput: [],
      buffer: '',
      ptyWs: null,
      controlWs: null,
      ptyOpen: false,
      starting: false,
      closed: false,
      resolvedClient: null,
    };
  }

  function sendInput(session: PtySession, input: string) {
    if (session.ptyOpen && session.ptyWs?.readyState === WebSocket.OPEN) sendPtyInput(session.ptyWs, input);
    else session.pendingInput.push(input);
  }

  function resizeSession(session: PtySession, cols?: number, rows?: number) {
    session.latestSize = {
      cols: Math.max(1, Math.min(300, Math.floor(cols ?? session.latestSize.cols))),
      rows: Math.max(1, Math.min(120, Math.floor(rows ?? session.latestSize.rows))),
    };
    session.resolvedClient?.client.sendTerminalResize(session.controlWs, session.latestSize.cols, session.latestSize.rows);
  }

  async function startSession(session: PtySession) {
    if (session.starting || session.ptyOpen || session.closed) return;
    session.starting = true;
    try {
      const resolvedClient = await machineClient(config, session.machineId);
      session.resolvedClient = resolvedClient;
      if (!resolvedClient) {
        terminateSession(session, `\r\n\x1b[31mMachine ${session.machineId} not found\x1b[0m\r\n`, 1008);
        return;
      }

      const instance = await resolvedClient.client.getInstance(resolvedClient.machine.incusInstanceName);
      if (instance.status.toLowerCase() !== 'running') {
        terminateSession(session, `\r\n\x1b[33mMachine is ${instance.status}. Start it before opening a terminal.\x1b[0m\r\n`, 1008);
        return;
      }

      const incusSession = await resolvedClient.client.createInteractiveExec(resolvedClient.machine.incusInstanceName, {
        cols: session.latestSize.cols,
        rows: session.latestSize.rows,
      });

      if (session.closed) return;

      session.ptyWs = resolvedClient.client.connectOperationWebSocket(incusSession.operation, incusSession.fds['0']);
      if (incusSession.fds.control) session.controlWs = resolvedClient.client.connectOperationWebSocket(incusSession.operation, incusSession.fds.control);

      session.controlWs?.on('open', () => resolvedClient.client.sendTerminalResize(session.controlWs, session.latestSize.cols, session.latestSize.rows));
      session.controlWs?.on('error', () => undefined);

      session.ptyWs.on('open', () => {
        session.ptyOpen = true;
        for (const input of session.pendingInput.splice(0)) sendPtyInput(session.ptyWs, input);
      });
      session.ptyWs.on('message', (data) => broadcast(session, messageToString(data)));
      session.ptyWs.on('close', () => {
        terminateSession(session, '\r\n\x1b[33mPTY disconnected\x1b[0m\r\n');
      });
      session.ptyWs.on('error', (error) => {
        terminateSession(session, `\r\n\x1b[31mPTY error: ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`, 1011);
      });
    } catch (error) {
      terminateSession(session, `\r\n\x1b[31mTerminal failed: ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`, 1011);
    } finally {
      session.starting = false;
    }
  }

  function attachClient(session: PtySession, browserWs: WebSocket) {
    session.clients.add(browserWs);
    if (session.buffer) sendText(browserWs, session.buffer);

    browserWs.on('close', (_code, reason) => {
      session.clients.delete(browserWs);
      if (!session.closed && reason.toString() === 'terminal tab closed') {
        terminateSession(session, '\r\n\x1b[33mPTY session closed\x1b[0m\r\n');
      }
    });
    browserWs.on('error', () => {
      session.clients.delete(browserWs);
    });
    browserWs.on('message', (data) => {
      const text = messageToString(data);
      try {
        const msg = JSON.parse(text) as { type?: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'close') {
          terminateSession(session, '\r\n\x1b[33mPTY session closed\x1b[0m\r\n');
          return;
        }
        if (msg.type === 'resize') {
          resizeSession(session, msg.cols, msg.rows);
          return;
        }
        if (msg.type === 'input' && typeof msg.data === 'string') {
          sendInput(session, msg.data);
          return;
        }
      } catch {
        // Backwards-compatible raw terminal data path.
      }
      sendInput(session, text);
    });
  }

  httpServer.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = url.pathname.match(/^\/machines\/([^/]+)\/pty$/);
    if (!match) {
      writeUpgradeError(socket, 404, 'Not Found');
      return;
    }

    const token = url.searchParams.get('token') || request.headers['sec-websocket-protocol']?.split(',')[0]?.trim() || null;
    if (!allowedToken(config, token)) {
      writeUpgradeError(socket, 401, 'Unauthorized');
      return;
    }

    const ctx: UpgradeContext = {
      machineId: decodeURIComponent(match[1]),
      sessionId: normalizeSessionId(url.searchParams.get('session')),
      cols: parsePositiveInt(url.searchParams.get('cols'), 120, 300),
      rows: parsePositiveInt(url.searchParams.get('rows'), 32, 120),
    };

    wss.handleUpgrade(request, socket, head, (ws) => {
      contexts.set(ws, ctx);
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (browserWs: WebSocket) => {
    const ctx = contexts.get(browserWs);
    if (!ctx) {
      browserWs.close(1011, 'missing terminal context');
      return;
    }
    const key = sessionKey(ctx.machineId, ctx.sessionId);
    const existing = sessions.get(key);
    const session = existing && !existing.closed ? existing : createSession(ctx);
    sessions.set(key, session);
    resizeSession(session, ctx.cols, ctx.rows);
    attachClient(session, browserWs);
    void startSession(session);
  });
}
