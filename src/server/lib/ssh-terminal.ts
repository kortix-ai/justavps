/**
 * SSH Terminal — creates an SSH connection to a machine and pipes it over a callback.
 * Used by the WebSocket terminal endpoint.
 */

import { Client } from 'ssh2';

interface SSHTerminalOpts {
  host: string;
  privateKey: string;
  username?: string;
  cols?: number;
  rows?: number;
  onData: (data: string) => void;
  onClose: (code: number) => void;
  onError: (err: string) => void;
}

export function createSSHTerminal(opts: SSHTerminalOpts) {
  const conn = new Client();
  let stream: any = null;

  conn.on('ready', () => {
    conn.shell(
      { term: 'xterm-256color', cols: opts.cols || 80, rows: opts.rows || 24 },
      (err, s) => {
        if (err) {
          opts.onError(err.message);
          conn.end();
          return;
        }
        stream = s;

        s.on('data', (data: Buffer) => {
          opts.onData(data.toString('utf-8'));
        });

        s.stderr.on('data', (data: Buffer) => {
          opts.onData(data.toString('utf-8'));
        });

        s.on('close', (code: number) => {
          opts.onClose(code || 0);
          conn.end();
        });
      }
    );
  });

  conn.on('error', (err) => {
    opts.onError(err.message);
  });

  conn.on('close', () => {
    opts.onClose(0);
  });

  conn.connect({
    host: opts.host,
    port: 22,
    username: opts.username || 'root',
    privateKey: opts.privateKey,
    readyTimeout: 10_000,
  });

  return {
    write(data: string) {
      if (stream) stream.write(data);
    },
    resize(cols: number, rows: number) {
      if (stream) stream.setWindow(rows, cols, 0, 0);
    },
    close() {
      if (stream) stream.close();
      conn.end();
    },
  };
}
