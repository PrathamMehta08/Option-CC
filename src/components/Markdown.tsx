'use client';

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The assistant writes markdown. Rendering it as plain text is what turned an
 * answer into a wall of pipes and asterisks — `| Exp date | Days | Strike |`
 * down the screen, with `**40.80 %**` in the middle of it.
 *
 * Every element is styled explicitly: Tailwind's preflight strips list markers
 * and heading sizes, so an unstyled renderer produces a different kind of
 * unreadable — one long undifferentiated column.
 *
 * The model is told to keep answers short and not to reproduce the results
 * table (the user is looking at it), but a model does not always comply, so
 * tables are supported and scroll inside their own box rather than stretching
 * the chat panel.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed text-fg [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="my-2" {...props} />,
          strong: (props) => <strong className="font-bold text-fg" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
          li: (props) => <li className="pl-0.5 marker:text-faint" {...props} />,
          h1: (props) => <h4 className="mb-1 mt-3 text-[13px] font-bold text-fg" {...props} />,
          h2: (props) => <h4 className="mb-1 mt-3 text-[13px] font-bold text-fg" {...props} />,
          h3: (props) => <h4 className="mb-1 mt-3 text-[13px] font-bold text-fg" {...props} />,
          h4: (props) => <h4 className="mb-1 mt-3 text-[13px] font-bold text-fg" {...props} />,
          a: (props) => (
            <a
              className="text-a1 underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="rounded bg-bg px-1 py-0.5 font-mono text-[11px] text-a1"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="my-2 overflow-x-auto rounded-md border border-line bg-bg p-2 font-mono text-[11px]"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote className="my-2 border-l-2 border-line pl-3 text-fg-soft" {...props} />
          ),
          hr: () => <hr className="my-3 border-line" />,
          // A wide table must scroll in its own box; letting it size the bubble
          // pushes the whole chat panel sideways.
          table: (props) => (
            <div className="my-2 overflow-x-auto rounded-md border border-line">
              <table className="w-full border-collapse text-[11px]" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-bg text-dim" {...props} />,
          th: (props) => (
            <th
              className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-semibold"
              {...props}
            />
          ),
          td: (props) => (
            <td className="whitespace-nowrap border-b border-line-soft px-2 py-1.5" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
