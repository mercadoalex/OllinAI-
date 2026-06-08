"use client";

import { docSections } from "./nav-data";

export function DocsSidebar({
  activeId,
  query,
  onSelect,
}: {
  activeId: string;
  query: string;
  onSelect: (id: string) => void;
}) {
  const normalized = query.trim().toLowerCase();

  const sections = docSections
    .map((section) => ({
      ...section,
      links: normalized
        ? section.links.filter((l) =>
            l.title.toLowerCase().includes(normalized),
          )
        : section.links,
    }))
    .filter((section) => section.links.length > 0);

  return (
    <nav
      aria-label="Documentation"
      className="flex flex-col gap-7 px-4 py-8"
    >
      {sections.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">
          No results found.
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.group}>
            <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.group}
            </h3>
            <ul className="mt-2 flex flex-col gap-0.5">
              {section.links.map((link) => {
                const isActive = link.id === activeId;
                return (
                  <li key={link.id}>
                    <a
                      href={`#${link.id}`}
                      onClick={() => onSelect(link.id)}
                      className={`block border-l-2 py-1.5 pl-3 pr-2 text-sm transition-colors ${
                        isActive
                          ? "border-primary font-medium text-primary"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {link.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}
