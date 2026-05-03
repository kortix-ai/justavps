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
    id: 'justavps-golden-container',
    name: 'Ubuntu 24.04',
    description: 'Base Ubuntu 24.04 container. Fast default for most machines.',
    type: 'container',
  },
];
