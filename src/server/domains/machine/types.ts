export type MachineMode = 'vm' | 'container';
export type MachineRuntimeKind = 'vm' | 'container_system' | 'container_app_docker';
export type MachineImageSourceKind = 'golden' | 'catalog' | 'docker';

export function deriveMachineImageSourceKind(input: {
  imageId?: string | null;
  dockerImage?: string | null;
}): MachineImageSourceKind {
  if (input.dockerImage) return 'docker';
  if (input.imageId) return 'catalog';
  return 'golden';
}

export function deriveMachineRuntimeKind(input: {
  machineMode: MachineMode;
  requestedImageKind: MachineImageSourceKind;
}): MachineRuntimeKind {
  if (input.machineMode === 'vm') return 'vm';
  if (input.requestedImageKind === 'docker') return 'container_app_docker';
  return 'container_system';
}
