// Public image catalog. Keep names boring and product-facing; the Incus
// aliases underneath can be noisy implementation details.

export type Template = {
  id: string;            // alias the user references when launching
  name: string;
  description: string;
  type: 'container' | 'vm';
};

export const TEMPLATES: Template[] = [
  {
    id: 'justavps-golden-container',
    name: 'Ubuntu 24.04',
    description: 'Base Ubuntu 24.04 container. Fast default for most machines.',
    type: 'container',
  },
  {
    id: 'justavps-golden',
    name: 'Ubuntu 24.04 VM',
    description: 'Base Ubuntu 24.04 virtual machine with full kernel isolation.',
    type: 'vm',
  },
];
