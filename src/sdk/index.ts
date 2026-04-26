/**
 * @kortix/justavps — TypeScript SDK for the JustAVPS V1 API.
 *
 * Hand-written ergonomic wrapper around the V1 HTTP surface. The OpenAPI
 * generator and V2 SDK have been removed; V2 lives in `apps/v2-api` and is
 * consumed directly via HTTP.
 */

export { JustAVPS, JustAVPSError } from './client';
export type { JustAVPSConfig } from './client';
