export type OpenApiDoc = {
  paths: Record<string, Record<string, { tags?: string[] }>>;
  tags?: Array<{ name: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export function filterOpenApiDocumentForPrefix<T extends OpenApiDoc>(doc: T, prefix: string): T {
  const nextPaths = Object.fromEntries(
    Object.entries(doc.paths)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, value]) => {
        const rewritten = path.slice(prefix.length) || '/';
        return [rewritten.startsWith('/') ? rewritten : `/${rewritten}`, value];
      }),
  );

  const usedTags = new Set<string>();
  for (const methods of Object.values(nextPaths)) {
    for (const operation of Object.values(methods)) {
      for (const tag of operation.tags ?? []) usedTags.add(tag);
    }
  }

  return {
    ...doc,
    paths: nextPaths,
    tags: (doc.tags ?? []).filter((tag) => usedTags.has(tag.name)),
  };
}
