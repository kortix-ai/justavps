export const BILLING_V2_COMPONENTS = {
  running_vcpu: { label: 'Running vCPU', quantityUnit: 'vcpu_second' },
  running_ram: { label: 'Running RAM', quantityUnit: 'ram_gb_second' },
  machine_disk: { label: 'Machine disk storage', quantityUnit: 'storage_gib_second' },
  snapshot_storage: { label: 'Snapshot storage', quantityUnit: 'storage_gib_second' },
  backup_storage: { label: 'Backup storage', quantityUnit: 'storage_gib_second' },
  template_storage: { label: 'Template image storage', quantityUnit: 'storage_gib_second' },
  warm_pool_storage: { label: 'Warm pool storage', quantityUnit: 'storage_gib_second' },
  warm_pool_running_vcpu: { label: 'Warm pool running vCPU', quantityUnit: 'vcpu_second' },
  warm_pool_running_ram: { label: 'Warm pool running RAM', quantityUnit: 'ram_gb_second' },
} as const;

export type BillingV2Component = keyof typeof BILLING_V2_COMPONENTS;

export const BILLING_V2_COMPONENT_ORDER: BillingV2Component[] = [
  'running_vcpu',
  'running_ram',
  'machine_disk',
  'snapshot_storage',
  'backup_storage',
  'template_storage',
  'warm_pool_storage',
  'warm_pool_running_vcpu',
  'warm_pool_running_ram',
];

export type BillingV2SourceType = 'machine' | 'snapshot' | 'backup' | 'template' | 'warm_pool';

export type BillingV2LedgerDraft = {
  accountId: string;
  machineId: string | null;
  sourceType: BillingV2SourceType;
  sourceId: string;
  component: BillingV2Component;
  region: string | null;
  intervalStart: Date;
  intervalEnd: Date;
  quantity: number;
  quantityUnit: string;
  rateMicroEurPerUnit: number;
  priceVersionId: string;
  microEur: bigint;
  status: 'finalized' | 'unfinalized';
  measurementSource: string;
  measurementExact: boolean;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
};

export type BillingV2RateSet = {
  vcpu_hot_micro_eur_per_sec: number;
  ram_gb_hot_micro_eur_per_sec: number;
  storage_gb_local_micro_eur_per_sec: number;
  storage_gb_archive_micro_eur_per_sec: number;
};
