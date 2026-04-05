export function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-2xl sm:text-3xl font-medium tracking-[-0.02em]">{title}</h2>
      <p className="text-sm text-muted-foreground/70 mt-2 max-w-xl leading-relaxed">{desc}</p>
    </div>
  );
}
