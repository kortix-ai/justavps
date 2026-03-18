"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface ConnectInfo {
  ssh_command: string | null;
  setup_command: string | null;
  vscode_url: string;
  vscode_password: string;
  cursor_ssh: string | null;
  claude_code: string | null;
}

interface ConnectGuideProps {
  connectInfo: ConnectInfo | null;
  machineStatus: string;
  machineIp: string | null;
  sshKey?: {
    private_key: string | null;
    setup_command: string | null;
    key_path: string;
  } | null;
}

export function ConnectGuide({ connectInfo, machineStatus, machineIp, sshKey }: ConnectGuideProps) {
  const [showSecrets, setShowSecrets] = useState(false);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  if (machineStatus === 'provisioning') {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="animate-pulse text-4xl mb-4">⏳</div>
          <p className="text-muted-foreground">Machine is provisioning... SSH will be ready in ~60 seconds.</p>
        </CardContent>
      </Card>
    );
  }

  if (!connectInfo || !machineIp) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Connection details not available yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* SSH Setup — the most important thing */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              SSH Access
              <Badge variant="default" className="text-xs">1-Click Setup</Badge>
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowSecrets(s => !s)}
            >
              {showSecrets ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showSecrets ? "Hide" : "Reveal"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="relative">
          {!showSecrets && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer rounded-b-xl"
              onClick={() => setShowSecrets(true)}
            >
              <span className="flex items-center gap-2 text-sm text-muted-foreground bg-background/80 backdrop-blur-sm px-4 py-2 rounded-full border shadow-sm hover:bg-background hover:text-foreground transition-colors">
                <Eye className="size-4" />
                Click to reveal
              </span>
            </div>
          )}
          <div className={`space-y-3 transition-[filter] duration-200 ${!showSecrets ? 'blur-[8px] select-none pointer-events-none' : ''}`}>
            {sshKey?.setup_command ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Run this in your terminal to save the SSH key and connect:
                </p>
                <div className="relative group">
                  <pre className="bg-[#09090b] text-green-400 p-3 rounded-lg text-xs overflow-x-auto font-mono leading-relaxed">
                    {sshKey.setup_command}
                  </pre>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copy(sshKey.setup_command!, 'Setup command')}
                  >
                    <Copy className="size-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </>
            ) : connectInfo.ssh_command ? (
              <>
                <p className="text-sm text-muted-foreground">SSH into your machine:</p>
                <div className="relative group">
                  <code className="block bg-[#09090b] text-green-400 p-3 rounded-lg text-sm font-mono">
                    {connectInfo.ssh_command}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copy(connectInfo.ssh_command!, 'SSH command')}
                  >
                    <Copy className="size-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </>
            ) : null}

            {sshKey?.private_key && (
              <div className="space-y-1.5 pt-1">
                <div className="text-sm font-medium">SSH Private Key</div>
                <div className="relative group">
                  <pre className="bg-[#09090b] p-3 rounded-lg text-xs overflow-x-auto font-mono text-muted-foreground max-h-48">
                    {sshKey.private_key}
                  </pre>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copy(sshKey.private_key!, 'Private key')}
                  >
                    <Copy className="size-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Other connection methods */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Other Ways to Connect</CardTitle>
        </CardHeader>
        <CardContent className="relative">
          {!showSecrets && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer rounded-b-xl"
              onClick={() => setShowSecrets(true)}
            >
              <span className="flex items-center gap-2 text-sm text-muted-foreground bg-background/80 backdrop-blur-sm px-4 py-2 rounded-full border shadow-sm hover:bg-background hover:text-foreground transition-colors">
                <Eye className="size-4" />
                Click to reveal
              </span>
            </div>
          )}
          <div className={`transition-[filter] duration-200 ${!showSecrets ? 'blur-[8px] select-none pointer-events-none' : ''}`}>
            <Tabs defaultValue="vscode">
              <TabsList>
                <TabsTrigger value="vscode">VS Code / Cursor</TabsTrigger>
                <TabsTrigger value="browser">Browser IDE</TabsTrigger>
              </TabsList>

              <TabsContent value="vscode" className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  1. Open VS Code &rarr; Command Palette &rarr; <strong>Remote-SSH: Connect to Host</strong>
                </p>
                <div className="relative group">
                  <code className="block bg-[#09090b] p-2 rounded text-sm font-mono text-foreground">
                    {connectInfo.cursor_ssh || `ssh root@${machineIp}`}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-1 right-1 h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copy(connectInfo.cursor_ssh || `ssh root@${machineIp}`, 'SSH')}
                  >
                    <Copy className="size-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="browser" className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">Open code-server in your browser:</p>
                <div className="relative group">
                  <code className="block bg-[#09090b] p-2 rounded text-sm font-mono text-foreground">
                    {connectInfo.vscode_url}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-1 right-1 h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copy(connectInfo.vscode_url, 'URL')}
                  >
                    <Copy className="size-3.5 mr-1" /> Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Password: <code className="bg-muted px-1 rounded">{connectInfo.vscode_password}</code>
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
