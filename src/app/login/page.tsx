"use client";

import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthMode = "login" | "register" | "apikey";

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Support both "next" and "callbackUrl" query params
  const next = searchParams.get("callbackUrl") || searchParams.get("next") || "/machines";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      setLoading(false);
      if (result?.error) {
        setError("Invalid email or password.");
      } else if (result?.ok) {
        router.push(next);
      } else {
        setError("Invalid email or password.");
      }
    } catch {
      setLoading(false);
      setError("Invalid email or password.");
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        setError(data.message || "Registration failed.");
        return;
      }

      // Auto-login after successful registration
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      setLoading(false);
      if (signInResult?.ok) {
        router.push(next);
      } else {
        // Registration succeeded but login failed — switch to login
        setError("Account created. Please sign in.");
        setMode("login");
      }
    } catch {
      setLoading(false);
      setError("Something went wrong. Please try again.");
    }
  }

  async function handleApiKeyAuth(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed, callbackUrl: next }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        setError(data.message || "Invalid API key.");
        return;
      }

      setLoading(false);

      // If we got a redirect URL (for proxy-auth flows), navigate there directly
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        // For regular dashboard access, sign in with returned credentials
        router.push(data.next || "/machines");
      }
    } catch {
      setLoading(false);
      setError("Failed to authenticate with API key.");
    }
  }

  function switchMode(newMode: AuthMode) {
    setMode(newMode);
    setError("");
  }

  const titles: Record<AuthMode, { title: string; description: string }> = {
    login: {
      title: "Welcome back",
      description: "Sign in to manage your cloud machines",
    },
    register: {
      title: "Create an account",
      description: "Get started with JustAVPS",
    },
    apikey: {
      title: "API Key Login",
      description: "Authenticate with your API key",
    },
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {titles[mode].title}
          </CardTitle>
          <CardDescription>
            {titles[mode].description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Tab Switcher */}
          <div className="flex mb-6 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === "login"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === "register"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => switchMode("apikey")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === "apikey"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              API Key
            </button>
          </div>

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Register
                </button>
              </p>
            </form>
          ) : mode === "register" ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="register-name">Name (optional)</Label>
                <Input
                  id="register-name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account..." : "Create Account"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Sign In
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleApiKeyAuth} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apikey-input">API Key</Label>
                <Input
                  id="apikey-input"
                  type="password"
                  placeholder="sk_live_..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Paste your API key to authenticate. You can generate keys from the{" "}
                <span className="font-medium">API Keys</span> page in the dashboard.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Authenticating..." : "Authenticate"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Prefer email login?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Sign In
                </button>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
