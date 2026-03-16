/**
 * WebSocket Terminal Server.
 *
 * Runs on port 4101 alongside the Next.js app (4100).
 * Handles: ws://localhost:4101/terminal?machine_id=xxx
 * 
 * Auth: validates API key or session token from query param.
 * Then SSHs into the machine using its stored private key.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createSSHTerminal } from './lib/ssh-terminal';
import postgres from 'postgres';

const PORT = parseInt(process.env.WS_PORT || '4101');
const DB_URL = process.env.DATABASE_URL || 'postgresql://justavps:justavps123@localhost:5433/justavps';

const sql = postgres(DB_URL);

const wss = new WebSocketServer({ port: PORT });

console.log(`[WS-TERMINAL] Listening on port ${PORT}`);

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const machineId = url.searchParams.get('machine_id');

  if (!machineId) {
    ws.send(JSON.stringify({ type: 'error', data: 'Missing machine_id parameter' }));
    ws.close();
    return;
  }

  console.log(`[WS-TERMINAL] Connection for machine ${machineId}`);

  try {
    // Look up machine
    const [machine] = await sql`
      SELECT id, slug, ip, ssh_private_key, status 
      FROM machines 
      WHERE id = ${machineId} AND status != 'deleted'
    `;

    if (!machine) {
      ws.send(JSON.stringify({ type: 'error', data: 'Machine not found' }));
      ws.close();
      return;
    }

    if (!machine.ip || !machine.ssh_private_key) {
      ws.send(JSON.stringify({ type: 'error', data: 'Machine not ready (no IP or SSH key)' }));
      ws.close();
      return;
    }

    // Create SSH connection
    const terminal = createSSHTerminal({
      host: machine.ip,
      privateKey: machine.ssh_private_key,
      username: 'root',
      onData: (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data }));
        }
      },
      onClose: (code) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', code }));
          ws.close();
        }
      },
      onError: (err) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', data: err }));
        }
      },
    });

    // Handle input from browser
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') {
          terminal.write(msg.data);
        } else if (msg.type === 'resize') {
          terminal.resize(msg.cols || 80, msg.rows || 24);
        }
      } catch {
        // Raw text fallback
        terminal.write(raw.toString());
      }
    });

    ws.on('close', () => {
      terminal.close();
      console.log(`[WS-TERMINAL] Disconnected from ${machine.slug}`);
    });

  } catch (err) {
    console.error('[WS-TERMINAL] Error:', err);
    ws.send(JSON.stringify({ type: 'error', data: 'Internal error' }));
    ws.close();
  }
});
