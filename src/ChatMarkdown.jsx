import { isValidElement, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconCopy, IconTextWrap, IconTextWrapDisabled } from "@tabler/icons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./chat-markdown.css";

const remarkPlugins = [remarkGfm];
const maxMarkdownLength = 48_000;

function CodeBlock({ children }) {
  const code = useRef(null);
  const [wrap, setWrap] = useState(true);
  const [copyStatus, setCopyStatus] = useState(null);
  const language = isValidElement(children) ? children.props.className?.match(/^language-([^\s]+)$/u)?.[1] : undefined;
  const wrapLabel = wrap ? "Disable word wrap" : "Enable word wrap";
  const copyLabel = copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed. Try again" : "Copy";
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(null), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  async function copy() {
    const text = code.current?.textContent;
    if (!text) return;
    try {
      if (window.aiDeck?.["copy-code"]) await window.aiDeck["copy-code"](text);
      else await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch { setCopyStatus("failed"); }
  }

  return <div className="deck-code-block" data-wrap={wrap ? "on" : "off"}>
    <div className="deck-code-toolbar">
      <span className="deck-code-language">{language || "Code"}</span>
      <div className="deck-code-actions">
        <button type="button" className="icon-button" title={wrapLabel} aria-label={wrapLabel} onClick={() => setWrap((current) => !current)}>
          {wrap ? <IconTextWrapDisabled size={15} aria-hidden="true" /> : <IconTextWrap size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-button" title={copyLabel} aria-label={copyLabel} onClick={copy}>
          {copyStatus === "copied" ? <IconCheck size={15} aria-hidden="true" /> : <IconCopy size={15} aria-hidden="true" />}
        </button>
      </div>
    </div>
    <pre ref={code} tabIndex={wrap ? undefined : 0}>{children}</pre>
  </div>;
}

const components = {
  a: ({ children, href }) => <span title={href || undefined}>{children}</span>,
  img: ({ alt }) => alt || null,
  pre: CodeBlock,
  table: ({ children }) => <div className="deck-markdown-table" tabIndex={0} role="region" aria-label="Table">
    <table>{children}</table>
  </div>,
};

export const ChatMarkdown = memo(function ChatMarkdown({ text, className = "", quote, replyRef }) {
  const value = useDeferredValue(text ?? "");
  const content = useMemo(() => value.length > maxMarkdownLength
    ? <p>{value}</p>
    : <Markdown remarkPlugins={remarkPlugins} components={components}>{value}</Markdown>, [value]);
  return <div className={`deck-markdown ${className}`.trim()} data-chat-quote={quote} ref={replyRef}>{content}</div>;
});
