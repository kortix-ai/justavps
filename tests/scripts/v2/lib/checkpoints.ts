import { promises as fs } from 'node:fs';
import path from 'node:path';

const CHECKPOINT_ROOT = path.join(process.cwd(), '.e2e-checkpoints');
const KEEP_E2E_STATE = (process.env.E2E_KEEP_STATE || '').trim().toLowerCase() === 'true';

type CheckpointEnvelope<T> = {
  suite: string;
  updatedAt: string;
  state: T;
};

export async function loadCheckpoint<T extends object>(suite: string, fallback: T): Promise<T> {
  const file = path.join(CHECKPOINT_ROOT, `${suite}.json`);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as CheckpointEnvelope<T> | T;
    if ('state' in (parsed as Record<string, unknown>)) {
      return { ...fallback, ...((parsed as CheckpointEnvelope<T>).state ?? {}) };
    }
    return { ...fallback, ...(parsed as T) };
  } catch {
    return { ...fallback };
  }
}

export async function saveCheckpoint<T extends object>(suite: string, state: T): Promise<void> {
  const file = path.join(CHECKPOINT_ROOT, `${suite}.json`);
  await fs.mkdir(CHECKPOINT_ROOT, { recursive: true });
  const payload: CheckpointEnvelope<T> = {
    suite,
    updatedAt: new Date().toISOString(),
    state,
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
}

export async function clearCheckpoint(suite: string): Promise<void> {
  const file = path.join(CHECKPOINT_ROOT, `${suite}.json`);
  await fs.rm(file, { force: true });
}

export function shouldKeepE2EState() {
  return KEEP_E2E_STATE;
}

export function checkpointFilePath(suite: string) {
  return path.join(CHECKPOINT_ROOT, `${suite}.json`);
}

export async function runCheckpointedStep<T extends object>(
  suite: string,
  state: T,
  stepKey: keyof T & string,
  isDone: (value: T[keyof T]) => boolean,
  action: () => Promise<Partial<T>>,
): Promise<T> {
  if (isDone(state[stepKey])) return state;
  const patch = await action();
  const next = { ...state, ...patch };
  await saveCheckpoint(suite, next);
  return next;
}
