import { describe, expect, it } from 'vitest';

import {
  deriveMachineImageSourceKind,
  deriveMachineRuntimeKind,
  type MachineImageSourceKind,
  type MachineRuntimeKind,
} from "@/server/v2/domains/machine/types";

describe('machine domain runtime typing', () => {
  it('derives runtime kind from machine mode and requested image kind', () => {
    expect(deriveMachineRuntimeKind({ machineMode: 'vm', requestedImageKind: 'golden' })).toBe<MachineRuntimeKind>('vm');
    expect(deriveMachineRuntimeKind({ machineMode: 'container', requestedImageKind: 'golden' })).toBe<MachineRuntimeKind>('container_system');
    expect(deriveMachineRuntimeKind({ machineMode: 'container', requestedImageKind: 'catalog' })).toBe<MachineRuntimeKind>('container_system');
    expect(deriveMachineRuntimeKind({ machineMode: 'container', requestedImageKind: 'docker' })).toBe<MachineRuntimeKind>('container_app_docker');
  });

  it('derives image source kind from create request inputs', () => {
    expect(deriveMachineImageSourceKind({ imageId: null, dockerImage: null })).toBe<MachineImageSourceKind>('golden');
    expect(deriveMachineImageSourceKind({ imageId: 'img-1', dockerImage: null })).toBe<MachineImageSourceKind>('catalog');
    expect(deriveMachineImageSourceKind({ imageId: null, dockerImage: 'docker:nginx:latest' })).toBe<MachineImageSourceKind>('docker');
  });
});
