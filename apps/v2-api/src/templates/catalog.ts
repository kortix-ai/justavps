// Server-side image catalog. The Incus image cache accumulates noise
// (every launch auto-pulls a base, aliases stick around forever). The
// templates list is the curated public surface — what users pick from when
// creating a machine. Everything else is plumbing.
//
// Keep public names boring. The IDs remain internal Incus aliases used to
// launch the images; UI should display the names instead.

export type TemplateDef = {
  id: string;            // alias users reference when launching
  name: string;
  description: string;
  type: 'container';
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'justavps-golden-container',
    name: 'Ubuntu 24.04',
    description: 'Base Ubuntu 24.04 container. Fast default for most machines.',
    type: 'container',
  },
];

export const TEMPLATE_IDS: ReadonlySet<string> = new Set(TEMPLATES.map((t) => t.id));

// True when any alias on an image matches a known template id.
export function imageMatchesTemplate(aliases: ReadonlyArray<{ name: string }>): boolean {
  for (const a of aliases) if (TEMPLATE_IDS.has(a.name)) return true;
  return false;
}
