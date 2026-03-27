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

    it('should NOT contain OS-level install logic except fail2ban (belongs in base image)', () => {
      const script = buildCloudInit(defaultOpts);
      // fail2ban is the only apt-get install allowed (security hardening)
      expect(script).toContain('apt-get install -y -qq fail2ban');
      // But no other package installations
      expect(script).not.toContain('gpg --dearmor');
      expect(script).not.toContain('deb.nodesource.com');
    });

    it('should install sandbox-agent if not present', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh');
      expect(script).toContain('sandbox-agent install-agent --all');
      expect(script).toContain('sandbox-agent.service');
      expect(script).toContain('sandbox-agent server --no-token --host 127.0.0.1 --port 2468');
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
      expect(script).toContain('chown -R user:user /home/user');
      expect(script).toContain("curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path");
      expect(script).toContain('cat > /etc/systemd/system/opencode-web.service');
      expect(script).toContain('ExecStart=/home/user/.opencode/bin/opencode serve --port 3456');
      expect(script).toContain('systemctl enable --now opencode-web');
      expect(script).toContain('systemctl enable --now sandbox-agent');
    });

    it('should lock public ingress to SSH and proxy only', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('ufw default deny incoming');
      expect(script).toContain('ufw allow 22/tcp');
      expect(script).toContain('ufw allow 80/tcp');
      expect(script).not.toContain('ufw allow 1024:65535/tcp');
      expect(script).toContain('justavps-docker-guard.sh');
      expect(script).toContain('JUSTAVPS-DOCKER-GUARD');
      expect(script).toContain('systemctl enable --now justavps-docker-guard');
    });

    it('should install and configure fail2ban for SSH protection', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('fail2ban');
      expect(script).toContain('jail.local');
      expect(script).toContain('bantime = 3600');
      expect(script).toContain('[sshd]');
      expect(script).toContain('enabled = true');
      expect(script).toContain('systemctl enable fail2ban');
    });

    it('should harden daemon systemd service with auto-restart', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('justavps-daemon.service');
      expect(script).toContain('Restart=always');
      expect(script).toContain('RestartSec=2');
      expect(script).toContain('StartLimitIntervalSec=0');
      expect(script).toContain('WatchdogSec=120');
    });

    it('should install self-healing watchdog timer', () => {
      const script = buildCloudInit(defaultOpts);
      expect(script).toContain('justavps-watchdog.sh');
      expect(script).toContain('justavps-watchdog.service');
      expect(script).toContain('justavps-watchdog.timer');
      expect(script).toContain('OnUnitActiveSec=120');
      expect(script).toContain('systemctl enable --now justavps-watchdog.timer');
      // Watchdog should re-download daemon if binary missing
      expect(script).toContain('Daemon binary missing, re-downloading');
      // Watchdog should re-enable fail2ban
      expect(script).toContain('fail2ban not running, starting');
      // Watchdog should re-enable UFW
      expect(script).toContain('UFW inactive, re-enabling');
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

});
