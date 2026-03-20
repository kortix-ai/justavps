"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  Container,
  HardDrive,
  KeyRound,
  Loader2,
  Monitor,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanPicker } from "@/components/plan-picker";
import { useAccountLimits } from "@/hooks/use-account";
import { useImages } from "@/hooks/use-images";
import { useCreateMachine } from "@/hooks/use-machines";
import { useSSHKeys } from "@/hooks/use-ssh-keys";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import type { Image } from "@/lib/types";
import { cn } from "@/lib/utils";

function CheckRow({
  checked,
  onToggle,
  icon: Icon,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  icon: React.ElementType;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        checked && !disabled
          ? "border-primary/30 bg-primary/5"
          : !disabled && "hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
          checked ? "border-primary bg-primary" : "border-muted-foreground/30",
        )}
      >
        {checked && <Check className="size-2.5 text-primary-foreground" />}
      </div>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

function ImageChoiceRow({
  image,
  selected,
  onClick,
}: {
  image: Image;
  selected: boolean;
  onClick: () => void;
}) {
  const kindLabel =
    image.kind === "template" ? "Public template" : "Your saved snapshot";

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors",
        selected ? "border-primary/30 bg-primary/5" : "hover:bg-muted/30",
      )}
    >
      <div className="min-w-0 flex items-center gap-3">
        <HardDrive className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm leading-tight">{image.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {kindLabel}
            {image.architecture ? ` · ${image.architecture}` : ""}
            {image.disk_size_gb ? ` · ${image.disk_size_gb} GB` : ""}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
          selected ? "border-primary bg-primary" : "border-muted-foreground/30",
        )}
      >
        {selected && <Check className="size-2.5 text-primary-foreground" />}
      </div>
    </div>
  );
}

type TemplateMode = "default" | "template" | "snapshot" | "docker";

export function ProvisionWizard() {
  const router = useRouter();

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const selectedProvider = providers[0]?.name || "";

  const { data: regions } = useRegions(selectedProvider || undefined);
  const [regionOverride, setRegionOverride] = useState("");
  const selectedRegion = regionOverride || regions?.[0]?.id || "";

  const { data: serverTypes } = useServerTypes(
    selectedProvider || undefined,
    selectedRegion || undefined,
  );
  const [serverTypeOverride, setServerTypeOverride] = useState("");
  const selectedServerType =
    serverTypeOverride ||
    serverTypes?.[Math.min(1, (serverTypes?.length ?? 1) - 1)]?.name ||
    "";

  const [machineName, setMachineName] = useState("");
  const [templateMode, setTemplateMode] = useState<TemplateMode>("default");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [dockerImage, setDockerImage] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [selectedSSHKeyIds, setSelectedSSHKeyIds] = useState<string[]>([]);

  const createMachine = useCreateMachine();
  const { data: limits } = useAccountLimits();
  const { data: userSSHKeys } = useSSHKeys();
  const { data: allImages } = useImages();

  const publicTemplates =
    allImages?.filter((image) => image.status === "ready" && image.kind === "template") ?? [];
  const userSnapshots =
    allImages?.filter((image) => image.status === "ready" && image.kind === "snapshot") ?? [];

  const selectedST = serverTypes?.find((serverType) => serverType.name === selectedServerType);
  const machineUsage = limits?.usage.machines ?? 0;
  const machineMax = limits?.limits.max_machines;
  const machineLimitReached = machineMax !== undefined && machineUsage >= machineMax;
  const machineLimitNear =
    machineMax !== undefined &&
    machineMax > 0 &&
    machineUsage / machineMax >= 0.8 &&
    !machineLimitReached;

  const selectionReady =
    templateMode === "template"
      ? Boolean(selectedImageId)
      : templateMode === "snapshot"
        ? Boolean(selectedImageId)
        : templateMode === "docker"
          ? Boolean(dockerImage.trim())
          : true;

  const canCreate = Boolean(
    selectedProvider &&
      selectedRegion &&
      selectedServerType &&
      selectionReady &&
      !machineLimitReached,
  );

  const chooseMode = (mode: TemplateMode) => {
    setTemplateMode(mode);
    if (mode === "template") {
      setSelectedImageId((current) => current ?? publicTemplates[0]?.id ?? null);
      return;
    }
    if (mode === "snapshot") {
      setSelectedImageId((current) => current ?? userSnapshots[0]?.id ?? null);
      return;
    }
    setSelectedImageId(null);
  };

  const handleCreate = () => {
    if (!canCreate) return;

    const imageId =
      templateMode === "template" || templateMode === "snapshot"
        ? selectedImageId ?? undefined
        : undefined;

    createMachine.mutate(
      {
        provider: selectedProvider,
        server_type: selectedServerType,
        region: selectedRegion,
        name: machineName || undefined,
        image_id: imageId,
        docker_image: templateMode === "docker" ? dockerImage || undefined : undefined,
        entrypoint: templateMode === "docker" ? entrypoint || undefined : undefined,
        ssh_key_ids: selectedSSHKeyIds.length > 0 ? selectedSSHKeyIds : undefined,
      },
      {
        onSuccess: (result) => {
          if (result.kind === "checkout") {
            toast.info("Redirecting to payment...");
            window.location.href = result.checkout.checkout_url;
            return;
          }
          toast.success("Machine created!");
          router.push(`/machines/${result.machine.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const hasExistingKeys = Boolean(userSSHKeys && userSSHKeys.length > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex items-center gap-3">
        <Link
          href="/machines"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="font-heading text-2xl tracking-tight">New Machine</h1>
      </div>

      <div className="mb-6">
        <PlanPicker
          regions={regions ?? undefined}
          serverTypes={serverTypes ?? undefined}
          selectedRegion={selectedRegion}
          selectedServerType={selectedServerType}
          onRegionChange={(region) => {
            setRegionOverride(region);
            setServerTypeOverride("");
          }}
          onServerTypeChange={setServerTypeOverride}
          showIncluded={false}
        />
      </div>

      {!machineLimitReached ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="space-y-5 p-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Box className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Boot Setup
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <CheckRow
                  checked={templateMode === "default"}
                  onToggle={() => chooseMode("default")}
                  icon={Monitor}
                  title="JustAVPS"
                  description="Base JustAVPS image with the standard platform stack"
                />
                <CheckRow
                  checked={templateMode === "template"}
                  onToggle={() => chooseMode("template")}
                  icon={Box}
                  title="Templates"
                  description={
                    publicTemplates.length > 0
                      ? `${publicTemplates.length} public templates available`
                      : "No public templates available yet"
                  }
                  disabled={publicTemplates.length === 0}
                />
                <CheckRow
                  checked={templateMode === "snapshot"}
                  onToggle={() => chooseMode("snapshot")}
                  icon={HardDrive}
                  title="My Snapshots"
                  description={
                    userSnapshots.length > 0
                      ? `${userSnapshots.length} saved snapshots available`
                      : "No saved snapshots yet"
                  }
                  disabled={userSnapshots.length === 0}
                />
                <CheckRow
                  checked={templateMode === "docker"}
                  onToggle={() => chooseMode("docker")}
                  icon={Container}
                  title="Docker Image"
                  description="Run a public container on boot on top of Ubuntu"
                />
              </div>
            </div>

            {templateMode === "template" && publicTemplates.length > 0 ? (
              <div className="space-y-2">
                {publicTemplates.map((image) => (
                  <ImageChoiceRow
                    key={image.id}
                    image={image}
                    selected={selectedImageId === image.id}
                    onClick={() => setSelectedImageId(image.id)}
                  />
                ))}
              </div>
            ) : null}

            {templateMode === "snapshot" && userSnapshots.length > 0 ? (
              <div className="space-y-2">
                {userSnapshots.map((image) => (
                  <ImageChoiceRow
                    key={image.id}
                    image={image}
                    selected={selectedImageId === image.id}
                    onClick={() => setSelectedImageId(image.id)}
                  />
                ))}
              </div>
            ) : null}

            {templateMode === "docker" ? (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="space-y-1.5">
                  <label htmlFor="prov-docker-image" className="text-xs text-muted-foreground">
                    Docker image
                  </label>
                  <Input
                    id="prov-docker-image"
                    placeholder="nginx:latest"
                    value={dockerImage}
                    onChange={(e) => setDockerImage(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Pulled and started with Docker on top of the Ubuntu base machine.
                    Your container stays separate from the default JustAVPS setup.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="prov-docker-entrypoint" className="text-xs text-muted-foreground">
                    Entrypoint command <span className="text-muted-foreground/60">(optional)</span>
                  </label>
                  <Input
                    id="prov-docker-entrypoint"
                    placeholder="/bin/sh -c 'my-command'"
                    value={entrypoint}
                    onChange={(e) => setEntrypoint(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            ) : null}

            <Input
              placeholder="Machine name (optional)"
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
            />

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  SSH Key
                </span>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5">
                <div className="flex size-4 shrink-0 items-center justify-center rounded border-2 border-primary bg-primary">
                  <Check className="size-2.5 text-primary-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  New key auto-generated and saved to your account
                </p>
              </div>

              {hasExistingKeys ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Also authorize your existing keys:
                  </p>
                  {userSSHKeys?.map((key) => {
                    const isSelected = selectedSSHKeyIds.includes(key.id);
                    return (
                      <CheckRow
                        key={key.id}
                        checked={isSelected}
                        onToggle={() =>
                          setSelectedSSHKeyIds((previous) =>
                            isSelected
                              ? previous.filter((id) => id !== key.id)
                              : [...previous, key.id],
                          )
                        }
                        icon={KeyRound}
                        title={key.name}
                        description={key.fingerprint}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t bg-muted/20 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tracking-tight tabular-nums">
                    ${selectedST?.price_monthly}
                  </span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selectedST?.vcpu} vCPU · {selectedST?.ram_gb} GB RAM ·{" "}
                  {regions?.find((region) => region.id === selectedRegion)?.city}
                </p>
              </div>
              <Button size="lg" onClick={handleCreate} disabled={createMachine.isPending || !canCreate}>
                {createMachine.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Deploying…
                  </>
                ) : (
                  "Deploy Machine"
                )}
              </Button>
            </div>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Shield className="size-3 text-green-600 dark:text-green-400" />
              <span>Daily backups included · Running in 60s · Cancel anytime</span>
            </div>
          </div>
        </div>
      ) : null}

      {(machineLimitReached || machineLimitNear) ? (
        <div
          className={cn(
            "mt-6 flex items-start gap-3 rounded-xl border p-4",
            machineLimitReached
              ? "border-destructive/20 bg-destructive/5"
              : "border-amber-500/20 bg-amber-500/10",
          )}
        >
          <AlertTriangle
            className={cn(
              "mt-0.5 size-5 shrink-0",
              machineLimitReached ? "text-destructive" : "text-amber-500",
            )}
          />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {machineLimitReached ? "Machine limit reached" : "Approaching machine limit"}
            </p>
            <p className="text-sm text-muted-foreground">
              You are using {machineUsage} of {machineMax} machines.
              {machineLimitReached
                ? " Delete an existing machine or contact support to increase your limit."
                : " You can still deploy, but you are close to your cap."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
