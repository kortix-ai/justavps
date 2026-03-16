/**
 * Client-side API utility.
 * 
 * Automatically includes credentials (session cookie) with every request.
 * The NextAuth session cookie is httpOnly so the browser sends it automatically.
 * No manual auth headers needed for browser-initiated requests.
 */

export const API_BASE = '/api/v1';

/**
 * Fetch wrapper that always sends credentials (session cookie).
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include', // Always send cookies
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

/**
 * Typed API fetch with error handling.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    if (res.status === 401) {
      // Redirect to login if we get 401
      if (typeof window !== 'undefined') {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
      throw new Error('Authentication required');
    }
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
      throw new Error('Authentication required');
    }
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return {} as T;
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
      throw new Error('Authentication required');
    }
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
}
