"use client";

import { useMessagePartText } from "@assistant-ui/react";
import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
} from "lucide-react";
import {
  Children,
  isValidElement,
  memo,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { ArtifactPreview } from "@/components/plan/artifact-preview";
import { downloadText, isPdfPath } from "@/components/plan/artifact-utils";
import { ChevronToggle } from "@/components/plan/chevron-toggle";
import {
  codeBlockId,
  CodeCollapseProvider,
  useCodeCollapse,
} from "@/components/plan/code-collapse";
import { HeaderActionButton } from "@/components/plan/header-action-button";
import {
  sectionsHaveDocument,
  splitMarkdownSections,
} from "@/components/plan/markdown-sections";
import { stripLegacyToolStatus } from "@/components/plan/strip-legacy-tool-status";
import { WorkspaceFilePreview } from "@/components/plan/workspace-file-preview";
import { SyntaxHighlighter } from "@/components/plan/shiki-highlighter";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

import "@assistant-ui/react-markdown/styles/dot.css";

function useCopyToClipboard(copiedDuration = 2000) {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = (value: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
}

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { t } = useAppLocale();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const collapse = useCodeCollapse();
  const id = codeBlockId(language, code);
  const open = !(collapse?.isCollapsed(id) ?? false);

  return (
    <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-surface-700/50 bg-surface-900/70 px-3 py-1.5 text-xs text-ink-400">
      <span className="min-w-0 flex-1 truncate font-mono lowercase">
        {language || "text"}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <ChevronToggle
          open={open}
          label={open ? t("plan.collapse") : t("plan.expand")}
          onClick={() => collapse?.toggle(id)}
        />
        <HeaderActionButton
          label={t("plan.copy")}
          showLabel
          onClick={() => {
            if (!code || isCopied) return;
            copyToClipboard(code);
          }}
        >
          {isCopied ? (
            <CheckIcon className="size-3.5 text-brand-400" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </HeaderActionButton>
        <HeaderActionButton
          label={t("plan.download")}
          showLabel
          onClick={() => {
            if (!code) return;
            downloadText(`snippet.${language || "txt"}`, code, "text/plain;charset=utf-8", {
              kind: "text",
              mimeType: "text/plain",
              onSuccess: (name) => toast.success(t("plan.downloadSuccess", { name })),
            });
          }}
        >
          <DownloadIcon className="size-3.5" />
        </HeaderActionButton>
      </div>
    </div>
  );
};

const proseElements = {
  h1: ({ className, ...props }: ComponentPropsWithoutRef<"h1">) => (
    <h1
      className={cn(
        "mb-3 mt-5 text-xl font-semibold tracking-tight text-ink-100 first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: ComponentPropsWithoutRef<"h2">) => (
    <h2
      className={cn(
        "mb-2 mt-4 text-lg font-semibold tracking-tight text-ink-100 first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: ComponentPropsWithoutRef<"h3">) => (
    <h3
      className={cn(
        "mb-2 mt-3 text-base font-semibold text-ink-100 first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: ComponentPropsWithoutRef<"h4">) => (
    <h4
      className={cn(
        "mb-1.5 mt-3 text-sm font-semibold text-ink-100 first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }: ComponentPropsWithoutRef<"h5">) => (
    <h5
      className={cn(
        "mb-1 mt-2 text-sm font-medium text-ink-200 first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }: ComponentPropsWithoutRef<"h6">) => (
    <h6
      className={cn(
        "mb-1 mt-2 text-xs font-medium uppercase tracking-wide text-ink-400 first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }: ComponentPropsWithoutRef<"p">) => (
    <p
      className={cn("my-2 leading-relaxed text-ink-200", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a
      className={cn(
        "font-medium text-brand-400 underline-offset-2 hover:underline",
        className,
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: ({
    className,
    ...props
  }: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className={cn(
        "my-3 border-l-2 border-brand-500/40 pl-3 text-ink-400 italic",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }: ComponentPropsWithoutRef<"ul">) => (
    <ul
      className={cn("my-2 list-disc space-y-1 pl-5 text-ink-200", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }: ComponentPropsWithoutRef<"ol">) => (
    <ol
      className={cn("my-2 list-decimal space-y-1 pl-5 text-ink-200", className)}
      {...props}
    />
  ),
  li: ({ className, ...props }: ComponentPropsWithoutRef<"li">) => (
    <li className={cn("leading-relaxed", className)} {...props} />
  ),
  hr: ({ className, ...props }: ComponentPropsWithoutRef<"hr">) => (
    <hr className={cn("my-4 border-surface-700/70", className)} {...props} />
  ),
  table: ({ className, ...props }: ComponentPropsWithoutRef<"table">) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-surface-700/70">
      <table
        className={cn("w-full border-collapse text-left text-sm", className)}
        {...props}
      />
    </div>
  ),
  thead: ({ className, ...props }: ComponentPropsWithoutRef<"thead">) => (
    <thead className={cn("bg-surface-900/80", className)} {...props} />
  ),
  th: ({ className, ...props }: ComponentPropsWithoutRef<"th">) => (
    <th
      className={cn(
        "border-b border-surface-700/70 px-3 py-2 font-semibold text-ink-100",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: ComponentPropsWithoutRef<"td">) => (
    <td
      className={cn(
        "border-b border-surface-800/80 px-3 py-2 text-ink-300",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }: ComponentPropsWithoutRef<"tr">) => (
    <tr className={cn("even:bg-surface-950/40", className)} {...props} />
  ),
  strong: ({ className, ...props }: ComponentPropsWithoutRef<"strong">) => (
    <strong className={cn("font-semibold text-ink-100", className)} {...props} />
  ),
};

const markdownComponents = memoizeMarkdownComponents({
  SyntaxHighlighter,
  CodeHeader,
  ...proseElements,
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "overflow-x-auto rounded-b-lg border border-t-0 border-surface-700/70 bg-surface-950/80",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "rounded bg-surface-800/80 px-1 py-0.5 font-mono text-[0.85em] text-brand-400",
          className,
        )}
        {...props}
      />
    );
  },
});

function extractCodeFromPreChildren(children: ReactNode): {
  language: string;
  code: string;
} | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return null;
  }
  const className = child.props.className ?? "";
  const match = /language-([\w+-]+)/.exec(className);
  const raw = child.props.children;
  const code = String(
    Array.isArray(raw) ? raw.join("") : (raw ?? ""),
  ).replace(/\n$/, "");
  return { language: match?.[1] ?? "text", code };
}

function StandalonePre({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  const extracted = extractCodeFromPreChildren(children);
  if (!extracted) {
    return (
      <pre
        className={cn(
          "overflow-x-auto rounded-lg border border-surface-700/70 bg-surface-950/80 p-3",
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-surface-700/70">
      <CodeHeader language={extracted.language} code={extracted.code} />
      <SyntaxHighlighter
        language={extracted.language}
        code={extracted.code}
        components={{
          Pre: ({ className: preClass, ...preProps }) => (
            <pre className={preClass} {...preProps} />
          ),
          Code: ({ className: codeClass, ...codeProps }) => (
            <code className={codeClass} {...codeProps} />
          ),
        }}
      />
    </div>
  );
}

const standaloneComponents = {
  ...proseElements,
  pre: StandalonePre,
  code: ({ className, ...props }: ComponentPropsWithoutRef<"code">) => {
    const isBlock = Boolean(className?.includes("language-"));
    return (
      <code
        className={cn(
          !isBlock &&
            "rounded bg-surface-800/80 px-1 py-0.5 font-mono text-[0.85em] text-brand-400",
          className,
        )}
        {...props}
      />
    );
  },
};

const markdownClassName =
  "aui-md prose prose-invert max-w-none text-sm leading-relaxed text-ink-200";

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className={markdownClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={standaloneComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownTextImpl() {
  const { text: rawText } = useMessagePartText();
  const { t } = useAppLocale();
  const text = useMemo(
    () => stripLegacyToolStatus(rawText ?? ""),
    [rawText],
  );
  const sections = useMemo(() => splitMarkdownSections(text), [text]);
  const hasDoc = sectionsHaveDocument(sections);

  if (!hasDoc) {
    return (
      <CodeCollapseProvider>
        <MarkdownTextPrimitive
          className={markdownClassName}
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          smooth
        />
      </CodeCollapseProvider>
    );
  }

  return (
    <CodeCollapseProvider>
      <div className="flex flex-col gap-2">
        {sections.map((section, index) => {
          if (section.type === "plain") {
            if (!section.content.trim()) return null;
            return <MarkdownBody key={`plain-${index}`} content={section.content} />;
          }
          if (isPdfPath(section.title)) {
            return (
              <WorkspaceFilePreview
                key={`doc-${index}-${section.title}`}
                path={section.title}
                title={section.title}
              />
            );
          }
          return (
            <ArtifactPreview
              key={`doc-${index}-${section.title}`}
              title={t("plan.fileQuickView")}
              downloadName={section.title}
              kind="markdown"
              content={section.content}
              encoding="utf8"
              mimeType="text/markdown"
            >
              <StandaloneMarkdown content={section.content} />
            </ArtifactPreview>
          );
        })}
      </div>
    </CodeCollapseProvider>
  );
}

export const MarkdownText = memo(MarkdownTextImpl);

/** Standalone markdown (file previews) — same styling as chat text parts. */
export function StandaloneMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <CodeCollapseProvider>
      <div className={cn(markdownClassName, className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={standaloneComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </CodeCollapseProvider>
  );
}
