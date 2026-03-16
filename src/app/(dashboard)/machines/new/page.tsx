import { ProvisionWizard } from "@/components/dashboard/provision-wizard";

export default function NewMachinePage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Create New Machine</h1>
        <p className="text-muted-foreground mt-2">
          Deploy a new VPS in just a few clicks
        </p>
      </div>

      <ProvisionWizard />
    </div>
  );
}