"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type CodeCollapseContextValue = {
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
};

const CodeCollapseContext = createContext<CodeCollapseContextValue | null>(
  null,
);

export function codeBlockId(
  language: string | undefined,
  code: string,
): string {
  return `${language ?? "text"}:${code.length}:${code.slice(0, 48)}`;
}

export function CodeCollapseProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isCollapsed = useCallback(
    (id: string) => Boolean(collapsed[id]),
    [collapsed],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const value = useMemo(
    () => ({ isCollapsed, toggle }),
    [isCollapsed, toggle],
  );

  return (
    <CodeCollapseContext.Provider value={value}>
      {children}
    </CodeCollapseContext.Provider>
  );
}

export function useCodeCollapse() {
  return useContext(CodeCollapseContext);
}
