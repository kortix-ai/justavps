/**
 * @kortix/justavps — TypeScript SDK for the JustAVPS API.
 *
 * 100% auto-generated from the OpenAPI spec. Do not edit manually.
 * Regenerate with: pnpm sdk:generate
 *
 * This barrel exports:
 * 1. The auto-generated typed SDK functions (flat, tree-shakeable)
 * 2. The auto-generated types
 * 3. The hand-written ergonomic wrapper (JustAVPS class)
 */

// ─── Auto-generated (zero maintenance) ─────────────────────────────────────
export * from './generated';

// ─── Ergonomic wrapper (thin, delegates to generated) ──────────────────────
export { JustAVPS, JustAVPSError } from './client';
export type { JustAVPSConfig } from './client';
