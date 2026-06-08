import type { ReactNode } from "react";

export function DocSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-border pb-14 pt-2">
      {eyebrow ? (
        <p className="mb-2 text-sm font-medium text-primary">{eyebrow}</p>
      ) : null}
      <h2 className="text-pretty text-3xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-6 max-w-3xl text-[16px] leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function Subheading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 mt-10 text-xl font-semibold text-foreground">
      {children}
    </h3>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <p className="mb-4 leading-7">{children}</p>;
}

export function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mb-4 flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 leading-7">
          <span
            aria-hidden="true"
            className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
