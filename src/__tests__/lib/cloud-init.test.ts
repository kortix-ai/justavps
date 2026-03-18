/**
 * Tests for cloud-init generator (smart install — installs on fresh Ubuntu, skips on images).
 */

import { describe, it, expect } from 'vitest';
import { buildCloudInit } from '@/server/lib/cloud-init';

describe('cloud-init', () => {
  const defaultOpts = {
    slug: 'test-machine',
    sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqP7Q6J8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k test@example.com',
    machineToken: 'mt_abcd1234',
    platformCallbackUrl: 'https://api.example.com/callback',
    proxyDomain: 'example.com',
  };

  describe('buildCloudInit', () => {
    it('should generate valid bash script', () => {
      const script = buildCloudInit(defaultOpts);
      
      // Should start with bash shebang
      expect(script).toMatch(/^#!\/bin\/bash/);
      expect(script).toContain('set -e');
      
      // Should contain expected sections
      expect(script).toContain('echo "[justavps] Configuring machine');
      expect(script).toContain('SSH keys for root + user');
      expect(script).toContain('Platform config');
      expect(script).toContain('Caddy config');
      expect(script).toContain('OpenCode Web UI');
      expect(script).toContain('Start pre-installed services');
      expect(script).toContain('echo "[justavps] Machine test-machine ready!"');
    });
    
    it('should inject slug correctly', () => {
      const script = buildCloudInit({ ...defaultOpts, slug: 'my-special-machine' });
      
      expect(script).toContain('[justavps] Configuring machine my-special-machine');
      expect(script).toContain('"slug": "my-special-machine"');
      expect(script).toContain('[justavps] Machine my-special-machine ready!');
    });
    
    it('should inject SSH public key', () => {
      const testKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDjI test@example.com';
      const script = buildCloudInit({ ...defaultOpts, sshPublicKey: testKey });
      
      expect(script).toContain(`echo '${testKey}' > /home/user/.ssh/authorized_keys`);
    });
    
    it('should inject machine token and callback URL', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        machineToken: 'mt_secret_token_123',
        platformCallbackUrl: 'https://platform.example.com/webhook',
      });
      
      expect(script).toContain('"machine_token": "mt_secret_token_123"');
      expect(script).toContain('"callback_url": "https://platform.example.com/webhook"');
    });
    
    it('should configure OpenCode as the default web IDE via Caddy', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        slug: 'my-machine',
        proxyDomain: 'mycloud.com',
      });
      
      // OpenCode served on root path via Caddy — no code-server
      expect(script).toContain('opencode serve --port 3456');
      expect(script).toContain('opencode-web.service');
      expect(script).not.toContain('code-server');
      expect(script).not.toContain('auth: none');
      expect(script).not.toContain('bind-addr: 127.0.0.1:8080');
    });
    
    it('should configure Caddy reverse proxy', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain(':80 {');
      expect(script).toContain('reverse_proxy localhost:3456');
    });
    
    it('should include smart install detection logic', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('if ! command -v opencode &>/dev/null; then');
      expect(script).toContain('Fresh Ubuntu detected');
    });
  });

  describe('smart install — installs platform on fresh Ubuntu', () => {
    it('should install Claude Code inside the if block', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('https://claude.ai/install.sh');
    });
    
    it('should install OpenCode and create systemd service', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('opencode');
      expect(script).toContain('opencode-web.service');
      expect(script).toContain('ExecStart=/usr/local/bin/opencode serve --port 3456');
      expect(script).toContain('systemctl enable --now opencode-web');
    });
  });
  
  describe('service configuration', () => {
    it('should create OpenCode web systemd service', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('opencode-web.service');
      expect(script).toContain('[Unit]');
      expect(script).toContain('Description=OpenCode Web UI');
      expect(script).toContain('User=user');
      expect(script).toContain('ExecStart=/usr/local/bin/opencode serve --port 3456');
      expect(script).toContain('[Install]');
      expect(script).toContain('WantedBy=multi-user.target');
    });
    
    it('should create Docker workload systemd service', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('justavps-docker.service');
      expect(script).toContain('Description=JustAVPS Docker Workload');
      expect(script).toContain('ExecStart=/usr/local/bin/justavps-docker-start.sh');
    });
    
    it('should enable and start all services including opencode-web', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('systemctl daemon-reload');
      expect(script).toContain('systemctl restart caddy');
      expect(script).toContain('systemctl enable --now opencode-web');
      expect(script).not.toContain('systemctl enable --now code-server');
    });
  });
  
  describe('user and permissions setup', () => {
    it('should create user with proper permissions', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('useradd -m -s /bin/bash -G sudo,docker user');
      expect(script).toContain('echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/user');
    });
    
    it('should setup SSH directory with correct permissions', () => {
      const script = buildCloudInit(defaultOpts);
      
      expect(script).toContain('mkdir -p /home/user/.ssh');
      expect(script).toContain('chmod 700 /home/user/.ssh');
      expect(script).toContain('chmod 600 /home/user/.ssh/authorized_keys');
      expect(script).toContain('chown -R user:user /home/user/.ssh');
    });
  });
  
  describe('config file generation', () => {
    it('should generate platform config JSON', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        slug: 'test-slug',
        platformCallbackUrl: 'https://api.test.com/callback',
        machineToken: 'mt_test_token',
        proxyDomain: 'test.com',
      });
      
      expect(script).toContain('cat > /etc/justavps/config.json << \'CONFIGEOF\'');
      expect(script).toContain('"slug": "test-slug"');
      expect(script).toContain('"callback_url": "https://api.test.com/callback"');
      expect(script).toContain('"machine_token": "mt_test_token"');
      // proxy_domain and proxy_auth_secret removed — auth is at CF Worker edge, not daemon
      expect(script).not.toContain('"proxy_domain"');
      expect(script).not.toContain('"proxy_auth_secret"');
    });
  });
});
