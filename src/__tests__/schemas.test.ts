/**
 * Tests for Zod validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  CreateMachineSchema,
  ResizeMachineSchema,
  CreateSSHKeySchema,
  CreateAPIKeySchema,
  HeartbeatSchema,
} from '@/lib/schemas';

describe('validation schemas', () => {
  describe('CreateMachineSchema', () => {
    const validData = {
      image_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      provider: 'hetzner',
      server_type: 'ccx13',
      region: 'hel1',
      name: 'my-test-machine',
    };

    it('should validate correct machine creation data', () => {
      const result = CreateMachineSchema.safeParse(validData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.server_type).toBe('ccx13');
        expect(result.data.name).toBe('my-test-machine');
        expect(result.data.region).toBe('hel1');
      }
    });

    it('should use default values for optional fields', () => {
      const minimalData = {
        provider: 'hetzner',
        server_type: 'ccx23',
        region: 'nbg1',
      };
      
      const result = CreateMachineSchema.safeParse(minimalData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBeUndefined(); // optional
        expect(result.data.image_id).toBeUndefined(); // optional
      }
    });

    it('should accept null image_id for Ubuntu default', () => {
      const data = {
        image_id: null,
        provider: 'hetzner',
        server_type: 'ccx23',
        region: 'nbg1',
      };
      
      const result = CreateMachineSchema.safeParse(data);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.image_id).toBeNull();
      }
    });

    it('should accept docker_image field', () => {
      const data = {
        ...validData,
        docker_image: 'nginx:latest',
      };
      
      const result = CreateMachineSchema.safeParse(data);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.docker_image).toBe('nginx:latest');
      }
    });

    it('should accept entrypoint field', () => {
      const data = {
        ...validData,
        entrypoint: 'sleep infinity',
      };
      
      const result = CreateMachineSchema.safeParse(data);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entrypoint).toBe('sleep infinity');
      }
    });

    it('should reject invalid server_type', () => {
      const invalidData = { ...validData, server_type: '' };
      const result = CreateMachineSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid region', () => {
      const invalidData = { ...validData, region: '' };
      const result = CreateMachineSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject name that is too long', () => {
      const invalidData = { ...validData, name: 'a'.repeat(65) };
      const result = CreateMachineSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const invalidData = { ...validData, name: '' };
      const result = CreateMachineSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = CreateMachineSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ResizeMachineSchema', () => {
    it('should validate correct resize data', () => {
      const validData = { server_type: 'ccx33' };
      const result = ResizeMachineSchema.safeParse(validData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.server_type).toBe('ccx33');
      }
    });

    it('should reject empty server_type', () => {
      const invalidData = { server_type: '' };
      const result = ResizeMachineSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject missing server_type', () => {
      const invalidData = {};
      const result = ResizeMachineSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('CreateSSHKeySchema', () => {
    const validData = {
      name: 'my-laptop',
      public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqP7Q6J8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k user@example.com'
    };

    it('should validate correct SSH key data', () => {
      const result = CreateSSHKeySchema.safeParse(validData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-laptop');
        expect(result.data.public_key).toContain('ssh-ed25519');
      }
    });

    it('should accept RSA keys', () => {
      const rsaData = {
        name: 'my-rsa-key',
        public_key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDjI+e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e user@example.com'
      };
      
      const result = CreateSSHKeySchema.safeParse(rsaData);
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const invalidData = { ...validData, name: '' };
      const result = CreateSSHKeySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject name that is too long', () => {
      const invalidData = { ...validData, name: 'a'.repeat(129) };
      const result = CreateSSHKeySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty public key', () => {
      const invalidData = { ...validData, public_key: '' };
      const result = CreateSSHKeySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const result1 = CreateSSHKeySchema.safeParse({ name: 'test' });
      const result2 = CreateSSHKeySchema.safeParse({ public_key: 'ssh-rsa ...' });
      
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });

  describe('CreateAPIKeySchema', () => {
    it('should validate correct API key data', () => {
      const validData = { name: 'production-api' };
      const result = CreateAPIKeySchema.safeParse(validData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('production-api');
      }
    });

    it('should reject empty name', () => {
      const invalidData = { name: '' };
      const result = CreateAPIKeySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject name that is too long', () => {
      const invalidData = { name: 'a'.repeat(129) };
      const result = CreateAPIKeySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject missing name', () => {
      const result = CreateAPIKeySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('HeartbeatSchema', () => {
    const validData = {
      slug: 'my-machine',
      machine_token: 'mt_abcd1234567890',
      uptime: 86400,
      services: {
        'opencode-web': true,
        'caddy': true,
        'docker': false
      },
      load: {
        cpu: 0.45,
        memory: 0.67,
        disk: 0.23
      }
    };

    it('should validate correct heartbeat data', () => {
      const result = HeartbeatSchema.safeParse(validData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slug).toBe('my-machine');
        expect(result.data.machine_token).toBe('mt_abcd1234567890');
        expect(result.data.uptime).toBe(86400);
        expect(result.data.services['opencode-web']).toBe(true);
        expect(result.data.load.cpu).toBe(0.45);
      }
    });

    it('should accept various service states', () => {
      const testData = {
        ...validData,
        services: {
          'service1': true,
          'service2': false,
          'service-with-dashes': true,
          'service_with_underscores': false
        }
      };
      
      const result = HeartbeatSchema.safeParse(testData);
      expect(result.success).toBe(true);
    });

    it('should accept various load values', () => {
      const testData = {
        ...validData,
        load: {
          cpu: 0.0,
          memory: 1.0,
          disk: 0.5
        }
      };
      
      const result = HeartbeatSchema.safeParse(testData);
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const testCases = [
        { ...validData, slug: undefined },
        { ...validData, machine_token: undefined },
        { ...validData, uptime: undefined },
        { ...validData, services: undefined },
        { ...validData, load: undefined }
      ];
      
      testCases.forEach((testCase) => {
        const result = HeartbeatSchema.safeParse(testCase);
        expect(result.success).toBe(false);
      });
    });

    it('should reject invalid load structure', () => {
      const testCases = [
        { ...validData, load: { cpu: 0.5 } }, // missing memory and disk
        { ...validData, load: { cpu: 'high', memory: 0.5, disk: 0.3 } }, // wrong type
        { ...validData, load: { cpu: 0.5, memory: 0.5 } } // missing disk
      ];
      
      testCases.forEach((testCase) => {
        const result = HeartbeatSchema.safeParse(testCase);
        expect(result.success).toBe(false);
      });
    });
  });
});
