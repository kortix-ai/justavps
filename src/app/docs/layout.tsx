import type { Metadata } from "next";
import { DocsShell } from "./docs-shell";

export const metadata: Metadata = {
  title: "Docs — API, SDKs & Machine Guides",
  description:
    "Documentation for justavps: REST API, TypeScript and Python SDKs, SSH access, images, and machine lifecycle. justavps.com is becoming platinum.dev — the most affordable AI agent sandbox cloud.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
