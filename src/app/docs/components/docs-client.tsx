"use client";

import { useEffect, useRef, useState } from "react";
import { DocsTopNav } from "./docs-top-nav";
import { DocsSidebar } from "./docs-sidebar";
import { DocsContent } from "./docs-content";
import { allLinks } from "./nav-data";

export function DocsClient() {
  const [activeId, setActiveId] = useState(allLinks[0].id);
  const [query, setQuery] = useState("");
  const clickScrollRef = useRef(false);

  // Scroll-spy: highlight the section currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (clickScrollRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: 0 },
    );

    allLinks.forEach((link) => {
      const el = document.getElementById(link.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const handleSelect = (id: string) => {
    setActiveId(id);
    clickScrollRef.current = true;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      clickScrollRef.current = false;
    }, 800);
  };

  return (
    <div className="min-h-screen bg-background scroll-smooth">
      <DocsTopNav query={query} onQueryChange={setQuery} />

      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-64 shrink-0 overflow-y-auto border-r border-border md:block">
          <DocsSidebar
            activeId={activeId}
            query={query}
            onSelect={handleSelect}
          />
        </aside>

        <main className="min-w-0 flex-1 px-5 py-10 md:px-10 lg:px-14">
          <div className="mx-auto max-w-3xl">
            <DocsContent />
          </div>
        </main>
      </div>
    </div>
  );
}
