import type { ReactNode } from "react";

export function CodeBlock({
  children,
  language,
}: {
  children: ReactNode;
  language?: string;
}) {
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      {language ? (
        <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-2">
          <span className="font-mono text-xs uppercase tracking-wide text-slate-400">
            {language}
          </span>
        </div>
      ) : null}
      <pre className="overflow-x-auto px-4 py-4">
        <code className="font-mono text-[13px] leading-relaxed text-slate-100">
          {children}
        </code>
      </pre>
    </div>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
      {children}
    </code>
  );
}
