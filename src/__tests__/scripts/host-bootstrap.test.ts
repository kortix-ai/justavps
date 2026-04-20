import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('host bootstrap phase renderer', () => {
  const root = process.cwd();
  const renderScript = path.join(root, 'scripts/deploy/host-bootstrap/render-bootstrap-remote.sh');

  it('renders remote bootstrap with all expected phases and doctor', () => {
    const output = execFileSync('bash', [renderScript], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        INCUS_CHANNEL: 'stable',
        STORAGE_DRIVER: 'dir',
        RUNNER_PORT: '7779',
      },
    });

    expect(output).toContain('00-prereqs.sh');
    expect(output).toContain('10-install-incus.sh');
    expect(output).toContain('20-configure-incus.sh');
    expect(output).toContain('25-seed-incus-baseline.sh');
    expect(output).toContain('30-install-runnerd.sh');
    expect(output).toContain('40-install-backups.sh');
    expect(output).toContain('50-configure-oci-remotes.sh');
    expect(output).toContain('/opt/justavps-host-bootstrap/doctor.sh');
    expect(output).toContain('INCUS_CHANNEL=stable');
    expect(output).toContain('INCUS_PROJECT=justavps-platform');
  });
});
