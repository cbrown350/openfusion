import { useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "../api";

/**
 * Render a model's generated text as GitHub-Flavored Markdown (tables, task lists,
 * strikethrough, autolinks). react-markdown renders to React elements without
 * dangerouslySetInnerHTML. Component overrides below match the prior hand-rolled
 * renderer's styling (teal headings, teal inline code, code block backgrounds).
 */
export function GenerationText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) {
    return <p className="text-sm italic text-white/40">No generation recorded for this sub-call.</p>;
  }
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <button
          className={`btn-icon ${copied ? "copied" : ""}`}
          onClick={() => void copy()}
          title={copied ? "Copied" : "Copy generation"}
          aria-label="Copy generation"
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <div>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** Props for a custom react-markdown component: the element's native props + the mdast node. */
type MdProps = { children?: ReactNode; className?: string };

/** Map markdown elements to the existing Tailwind styling. */
const components: Components = {
  h1: ({ className, ...p }: MdProps) => <p className={`mb-1 font-semibold text-base text-[#4cd0b0] ${className ?? ""}`} {...p} />,
  h2: ({ className, ...p }: MdProps) => <p className={`mb-1 font-semibold text-base text-[#4cd0b0] ${className ?? ""}`} {...p} />,
  h3: ({ className, ...p }: MdProps) => <p className={`mb-1 font-semibold text-sm text-[#4cd0b0] ${className ?? ""}`} {...p} />,
  h4: ({ className, ...p }: MdProps) => <p className={`mb-1 font-semibold text-sm ${className ?? ""}`} {...p} />,
  p: ({ className, ...p }: MdProps) => <p className={`mb-2 leading-relaxed ${className ?? ""}`} {...p} />,
  ul: ({ className, ...p }: MdProps) => <ul className={`mb-2 ml-5 list-disc space-y-0.5 ${className ?? ""}`} {...p} />,
  ol: ({ className, ...p }: MdProps) => <ol className={`mb-2 ml-5 list-decimal space-y-0.5 ${className ?? ""}`} {...p} />,
  li: ({ className, ...p }: MdProps) => <li className={`text-sm leading-relaxed ${className ?? ""}`} {...p} />,
  code: ({ className, children, ...p }: MdProps) => {
    // Inline code vs fenced block: react-markdown renders fenced code as <code className="language-*"> inside <pre>.
    if (className && className.includes("language-")) {
      return (
        <code className={className} {...p}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-black/40 px-1 text-xs text-[#4cd0b0]" {...p}>
        {children}
      </code>
    );
  },
  pre: ({ className, ...p }: MdProps) => (
    <pre className={`mb-2 overflow-x-auto rounded bg-black/40 p-2 text-xs ${className ?? ""}`} {...p} />
  ),
  a: ({ className, ...p }: MdProps) => (
    <a className={`text-[#4cd0b0] underline ${className ?? ""}`} target="_blank" rel="noreferrer" {...p} />
  ),
  table: ({ className, ...p }: MdProps) => (
    <div className="mb-2 overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${className ?? ""}`} {...p} />
    </div>
  ),
  thead: ({ className, ...p }: MdProps) => <thead className={`text-left text-white/60 ${className ?? ""}`} {...p} />,
  th: ({ className, ...p }: MdProps) => (
    <th className={`border border-white/15 px-2 py-1 font-semibold ${className ?? ""}`} {...p} />
  ),
  td: ({ className, ...p }: MdProps) => (
    <td className={`border border-white/15 px-2 py-1 align-top ${className ?? ""}`} {...p} />
  ),
  blockquote: ({ className, ...p }: MdProps) => (
    <blockquote className={`mb-2 border-l-2 border-white/20 pl-3 text-white/70 ${className ?? ""}`} {...p} />
  ),
  hr: ({ className, ...p }: MdProps) => <hr className={`my-3 border-white/15 ${className ?? ""}`} {...p} />,
};
