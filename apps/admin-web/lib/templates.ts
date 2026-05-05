// Public image catalog. Keep names boring and product-facing; the Incus
// aliases underneath can be noisy implementation details.

export type Template = {
  id: string;            // alias the user references when launching
  name: string;
  description: string;
  type: 'container';
};

export const TEMPLATES: Template[] = [
  {
    id: 'justavps-ubuntu-24.04-template',
    name: 'Ubuntu 24.04',
    description: 'Boot-optimized Ubuntu 24.04 container template with JustAVPS tooling baked and verified.',
    type: 'container',
  },
];
