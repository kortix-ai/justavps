/**
 * @kortix/justavps-v2 — TypeScript SDK for the JustAVPS V2 API.
 *
 * The ergonomic façade lives in `client.ts`. The auto-generated low-level
 * functions + types live in `./generated/`; re-exported here for callers who
 * need to bypass the façade.
 */

export { JustAVPSV2, JustAVPSV2Error } from './client.js';
export type { JustAVPSV2Config } from './client.js';
export type {
  CreateMachineBody,
  CreateSnapshotBody,
  CreateBackupBody,
  CreateImageBody,
  ExecBody,
  ExecResponse,
  FileWriteBody,
  RestoreBody,
} from './client.js';

export * as generated from './generated/sdk.gen.js';
export * as types from './generated/types.gen.js';
