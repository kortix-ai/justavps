/**
 * Tests for cloud-init generator.
 * Cloud-init is config-only — all software lives in the base image.
 * The daemon on :80 replaces Caddy entirely.
 */

import { describe, it, expect } from 'vitest';
import { buildCloudInit } from '@/server/lib/cloud-init';

describe('cloud-init', () => {
  const defaultOpts = {
    slug: 'test-machine',
    sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqP7Q test@example.com',
    machineToken: 'mt_abcd1234',
    platformCallbackUrl: 'https://api.example.com/callback',
    proxyDomain: 'example.com',
  };

  describe('script structure', () => {
    it('should generate valid bash script', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toMatch(/^#!\/bin\/bash/);
      expect(script).toContain('[justavps] Configuring machine test-machine');
      expect(script).toContain('[justavps] Machine test-machine ready!');
    });

    it('should NOT use set -e (critical config must survive individual failures)', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).not.toMatch(/^set -e$/m);
    });

    it('should NOT contain OS-level install logic (belongs in base image)', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).not.toContain('apt-get install');
      expect(script).not.toContain('apt-get update');
      expect(script).not.toContain('gpg --dearmor');
      expect(script).not.toContain('deb.nodesource.com');
    });

    it('should install sandbox-agent if not present', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh');
      expect(script).toContain('sandbox-agent install-agent --all');
      expect(script).toContain('sandbox-agent.service');
      expect(script).toContain('sandbox-agent server --no-token --host 0.0.0.0 --port 2468');
    });

    it('should NOT use Caddy (daemon handles :80 now)', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).not.toContain('Caddyfile');
      expect(script).not.toContain('systemctl enable caddy');
      expect(script).not.toContain('systemctl restart caddy');
      expect(script).toContain('systemctl disable --now caddy');
    });
  });

  describe('machine identity', () => {
    it('should inject slug', () => {
      const script = buildCloudInit({ ...defaultOpts, slug: 'my-machine' });
      expect(script).toContain('"slug": "my-machine"');
      expect(script).toContain('[justavps] Machine my-machine ready!');
    });

    it('should inject SSH public key for root and user', () => {
      const key = 'ssh-rsa AAAAB3NzaC1yc2E test@example.com';
      const script = buildCloudInit({ ...defaultOpts, sshPublicKey: key });
      expect(script).toContain(`echo '${key}' >> /root/.ssh/authorized_keys`);
      expect(script).toContain(`echo '${key}' > /home/user/.ssh/authorized_keys`);
    });

    it('should lock root password and clear expiry flags', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('passwd -d root');
      expect(script).toContain('chage -M -1 root');
      expect(script).toContain('chage -E -1 root');
      expect(script).toContain('passwd -l root');
    });

    it('should disable password-based SSH authentication', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('PasswordAuthentication no');
      expect(script).toContain('PermitRootLogin prohibit-password');
      expect(script).toContain('ChallengeResponseAuthentication no');
      expect(script).toContain('KbdInteractiveAuthentication no');
      expect(script).toContain('rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf');
    });

    it('should inject machine token and callback URL', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        machineToken: 'mt_secret_123',
        platformCallbackUrl: 'https://platform.example.com',
      });
      expect(script).toContain('"machine_token": "mt_secret_123"');
      expect(script).toContain('"callback_url": "https://platform.example.com"');
    });
  });

  describe('config files', () => {
    it('should write config.json with correct fields', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        slug: 'test-slug',
        platformCallbackUrl: 'https://api.test.com',
        machineToken: 'mt_test',
      });
      expect(script).toContain("cat > /etc/justavps/config.json << 'CONFIGEOF'");
      expect(script).toContain('"slug": "test-slug"');
      expect(script).toContain('"callback_url": "https://api.test.com"');
      expect(script).toContain('"machine_token": "mt_test"');
    });

    it('should base64-encode environment variables', () => {
      const script = buildCloudInit({ ...defaultOpts, envVars: { FOO: 'bar' } });
      expect(script).toContain('base64 -d > /etc/justavps/env');
    });
  });

  describe('daemon', () => {
    it('should download latest daemon binary (with fallback for snapshot)', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('justavps-daemon-linux-amd64');
      // Either fresh download or background update for snapshot-based installs
      expect(script).toContain('Downloading daemon');
      expect(script).toContain('background-updating');
    });

    it('should use production R2 path by default (no daemonChannel)', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('daemon/latest/justavps-daemon-linux-amd64');
      expect(script).not.toContain('daemon/dev/latest');
    });

    it('should use production R2 path when daemonChannel is "latest"', () => {
      const script = buildCloudInit({ ...defaultOpts, daemonChannel: 'latest' });
      expect(script).toContain('daemon/latest/justavps-daemon-linux-amd64');
      expect(script).not.toContain('daemon/dev/latest');
    });

    it('should use dev R2 path when daemonChannel is "dev"', () => {
      const script = buildCloudInit({ ...defaultOpts, daemonChannel: 'dev' });
      expect(script).toContain('daemon/dev/latest/justavps-daemon-linux-amd64');
    });

    it('should enable and start daemon as the primary service', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('systemctl enable justavps-daemon 2>/dev/null || true');
      expect(script).toContain('systemctl restart justavps-daemon 2>/dev/null || true');
    });
  });

  describe('upstream services', () => {
    it('should start opencode-web and sandbox-agent', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('systemctl enable --now opencode-web');
      expect(script).toContain('systemctl enable --now sandbox-agent');
    });

    it('should create user account with sudo + docker access', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('useradd -m -s /bin/bash -G sudo,docker user');
      expect(script).toContain('NOPASSWD:ALL');
    });
  });

  describe('stage callbacks', () => {
    it('should report cloud_init_running and cloud_init_done', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('"stage":"cloud_init_running"');
      expect(script).toContain('"stage":"cloud_init_done"');
    });

    it('should include error reporting trap', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('report_error');
      expect(script).toContain('cloud_init_error');
      expect(script).toContain('trap');
    });
  });

  describe('docker workload', () => {
    it('should include docker block when dockerImage is specified', () => {
      const script = buildCloudInit({ ...defaultOpts, dockerImage: 'myapp:latest' });
      expect(script).toContain('justavps-docker.service');
      expect(script).toContain('RUN_ARGS=(');
      expect(script).toContain('--name justavps-workload');
      expect(script).toContain('bXlhcHA6bGF0ZXN0');
      expect(script).toContain('systemctl enable justavps-docker 2>/dev/null || true');
      expect(script).toContain('systemctl restart justavps-docker');
      expect(script).toContain('docker-host-ports');
    });

    it('should NOT include docker block when no dockerImage', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).not.toContain('docker run --rm --name justavps-workload');
    });

    it('should include entrypoint when specified', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        dockerImage: 'myapp:latest',
        entrypoint: '/start.sh',
      });
      expect(script).toContain('DOCKER_ENTRYPOINT=');
      expect(script).toContain('RUN_ARGS+=(--entrypoint "$DOCKER_ENTRYPOINT")');
      expect(script).toContain('L3N0YXJ0LnNo');
    });

    it('should include command when specified', () => {
      const script = buildCloudInit({
        ...defaultOpts,
        dockerImage: 'myapp:latest',
        command: 'sleep infinity',
      });
      expect(script).toContain('append_command_args "$DOCKER_COMMAND"');
      expect(script).toContain("b'\\0'");
      expect(script).toContain('c2xlZXAgaW5maW5pdHk=');
    });

    it('should remap container port 80 to host 8080', () => {
      const script = buildCloudInit({ ...defaultOpts, dockerImage: 'nginx:latest' });
      expect(script).toContain('80) echo 8080');
    });
  });
});
