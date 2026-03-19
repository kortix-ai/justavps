const API_BASE = "/api/v1";

export class ApiError extends Error {
  /** Parsed JSON body from the error response (if available) */
  data?: Record<string, unknown>;

  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  if (res.status === 401 && typeof window !== "undefined") {
    // Sign out first to clear the stale session cookie, otherwise the
    // middleware will redirect authenticated users away from /login
    // back to /machines, creating an infinite redirect loop.
    const next = encodeURIComponent(window.location.pathname);
    try {
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `csrfToken=${csrf.csrfToken}`,
        credentials: "include",
      });
    } catch {
      // Best-effort — continue to redirect regardless
    }
    window.location.href = `/login?next=${next}`;
    throw new ApiError(401, "Authentication required");
  }

  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  const err = new ApiError(res.status, body.message || `Request failed: ${res.status}`);
  // Attach the full response body so callers can inspect structured error data
  // (e.g. 402 checkout_url from the billing gate)
  err.data = body;
  throw err;
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };

  // Only set Content-Type for requests with a body
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  }).then((res) => handleResponse<T>(res));
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
};
