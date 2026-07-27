"use client";

import type { SyntaxHighlighterProps as AUIProps } from "@assistant-ui/react-markdown";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { FC } from "react";
import { useShikiHighlighter, type ShikiHighlighterProps } from "react-shiki";

import { codeBlockId, useCodeCollapse } from "@/components/plan/code-collapse";
import { cn } from "@/lib/utils";

export type HighlighterProps = Omit<
  ShikiHighlighterProps,
  "children" | "theme"
> & {
  theme?: ShikiHighlighterProps["theme"];
} & Pick<AUIProps, "language" | "code"> &
  Partial<Pick<AUIProps, "node" | "components">>;

const containerClassName =
  "aui-shiki-base overflow-hidden [&_pre]:!m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-surface-950/80! [&_pre]:p-3.5 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_.line]:px-0!";

const PlainCode: FC<{ code: string }> = ({ code }) => (
  <pre className="m-0 overflow-x-auto bg-surface-950/80 p-3.5 text-[13px] leading-relaxed text-ink-200">
    <code>{code}</code>
  </pre>
);

const HighlightedCode: FC<{
  code: string;
  language: HighlighterProps["language"];
  theme: NonNullable<HighlighterProps["theme"]>;
  options: Omit<ShikiHighlighterProps, "children" | "language" | "theme">;
}> = ({ code, language, theme, options }) => {
  const highlighted = useShikiHighlighter(code, language, theme, {
    ...options,
    defaultColor: "light-dark()",
  });
  return <>{highlighted ?? <PlainCode code={code} />}</>;
};

/**
 * Syntax highlighter for markdown fenced code — skips tokenization while
 * the message part is still streaming.
 */
export const SyntaxHighlighter: FC<HighlighterProps> = ({
  code,
  language,
  theme = { dark: "github-dark-default", light: "github-light-default" },
  className,
  style,
  addDefaultStyles: _addDefaultStyles,
  showLanguage: _showLanguage,
  delay = 150,
  node: _node,
  components: _components,
  ...options
}) => {
  const collapse = useCodeCollapse();
  const id = codeBlockId(language, code);
  const collapsed = collapse?.isCollapsed(id) ?? false;

  const aui = useAui();
  const hasPart = aui.part.source !== null;
  const isStreaming = useAuiState(
    (s) => hasPart && s.part.status.type === "running",
  );

  if (collapsed) return null;

  const trimmed = code.trim();

  return (
    <div className={cn(containerClassName, className)} style={style}>
      {isStreaming ? (
        <PlainCode code={trimmed} />
      ) : (
        <HighlightedCode
          code={trimmed}
          language={language || "text"}
          theme={theme}
          options={{ delay, ...options }}
        />
      )}
    </div>
  );
};

SyntaxHighlighter.displayName = "SyntaxHighlighter";
