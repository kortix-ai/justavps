import { redirect } from "next/navigation";

export default function LegacyFleetPage() {
  redirect("/v2/admin/hosts");
}
