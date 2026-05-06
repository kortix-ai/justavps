interface IncusCommandRunner {
  (args: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string }>;
}

function normalizeImageAlias(image: string) {
  return image.startsWith('images:') ? image.slice('images:'.length) : image;
}

async function ensureOciRemote(name: string, url: string, deps: { runIncus: IncusCommandRunner }) {
  const { stdout } = await deps.runIncus(['remote', 'list', '--format', 'csv']);
  if (stdout.split('\n').some((line) => line.startsWith(`${name},`))) return true;

  try {
    await deps.runIncus(['remote', 'add', name, url, '--protocol=oci'], 30000);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid protocol|unsupported protocol/i.test(message)) return false;
    if (/already exists/i.test(message)) return true;
    throw error;
  }
}

export async function resolveVmImageReference(image: string, deps: { runIncus: IncusCommandRunner }) {
  const alias = normalizeImageAlias(image);
  const { stdout } = await deps.runIncus(['image', 'list', 'images:', '--format', 'csv']);
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => line.toLowerCase().includes(alias.toLowerCase()) && line.includes('VIRTUAL-MACHINE'));
  if (!match) return image;
  const fingerprint = match.split(',')[1]?.trim();
  return fingerprint ? `images:${fingerprint}` : image;
}

export async function resolveContainerImageReference(image: string, deps: { runIncus: IncusCommandRunner }) {
  if (/^(docker|oci):/i.test(image)) {
    const [remote, ...rest] = image.split(':');
    const remainder = rest.join(':');
    if (!remote || !remainder) throw new Error(`Invalid OCI image ref: ${image}`);

    const remoteUrl = remote === 'docker' ? 'https://docker.io' : null;
    if (!remoteUrl) throw new Error(`Unsupported OCI remote '${remote}'. Supported now: docker:`);

    const supported = await ensureOciRemote(remote, remoteUrl, deps);
    if (!supported) {
      throw new Error('OCI/Docker registry image refs are not supported on this host yet (Incus build lacks OCI remote support). Upgrade host Incus/bootstrap to stable 6.3+ with skopeo/umoci.');
    }

    return image;
  }

  if (image === 'justavps-golden' || image.startsWith('justavps-golden')) {
    try {
      const { stdout } = await deps.runIncus(['image', 'list', 'local:', '--format', 'csv']);
      if (stdout.split('\n').some((line) => line.startsWith('justavps-golden-container,'))) {
        return 'justavps-golden-container';
      }
    } catch {
      // ignore and fall back
    }

    return 'images:ubuntu/noble';
  }

  const alias = normalizeImageAlias(image);
  const { stdout } = await deps.runIncus(['image', 'list', 'images:', '--format', 'csv']);
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => line.toLowerCase().includes(alias.toLowerCase()) && line.includes('CONTAINER'));
  if (!match) return image;
  const fingerprint = match.split(',')[1]?.trim();
  return fingerprint ? `images:${fingerprint}` : image;
}
