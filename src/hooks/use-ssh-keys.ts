import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import type { SSHKey } from "@/lib/types";

export const sshKeyKeys = {
  all: ["ssh-keys"] as const,
};

export function useSSHKeys(enabled = true) {
  return useQuery({
    queryKey: sshKeyKeys.all,
    queryFn: () => api.get<{ ssh_keys: SSHKey[] }>("/ssh-keys").then((d) => d.ssh_keys),
    enabled,
  });
}

interface CreateSSHKeyInput {
  name: string;
  public_key: string;
}

export function useCreateSSHKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSSHKeyInput) => api.post<SSHKey>("/ssh-keys", input),
    onSuccess: (key) => {
      qc.setQueryData<SSHKey[]>(sshKeyKeys.all, (old) => (old ? [...old, key] : [key]));
    },
  });
}

export function useDeleteSSHKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ssh-keys/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: sshKeyKeys.all });
      const previous = qc.getQueryData<SSHKey[]>(sshKeyKeys.all);
      qc.setQueryData<SSHKey[]>(sshKeyKeys.all, (old) => old?.filter((k) => k.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(sshKeyKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: sshKeyKeys.all });
    },
  });
}
