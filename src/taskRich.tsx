// One task title. At rest, web addresses are real links. Clicking the words
// opens Quill's bubble editor: select text for the bold and link tooltip,
// or press Ctrl+B and Ctrl+K. The editor closes when focus leaves it.

import { useEffect, useRef, useState } from "react";
import Quill from "quill";
import "quill/dist/quill.bubble.css";
import { taskFromEditorHtml, taskToEditorHtml, taskToHtml } from "./taskMarkup";

type LinkTooltip = {
  edit: (mode?: string, preview?: string | null) => void;
  root: HTMLElement;
};

export function TaskHtml({ value }: { value: string }) {
  const html = taskToHtml(value);
  if (!html) return null;
  return <span className="task-html" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TaskEditor({
  value,
  label,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    const html = taskToHtml(value);
    return (
      <div
        className="task-readout"
        role="textbox"
        tabIndex={0}
        aria-label={label}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) return;
          setEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          setEditing(true);
        }}
      >
        {html ? <TaskHtml value={value} /> : <span className="task-placeholder">{placeholder}</span>}
      </div>
    );
  }
  return (
    <QuillTask
      value={value}
      label={label}
      placeholder={placeholder}
      onCommit={(next) => {
        onCommit(next);
        setEditing(false);
      }}
    />
  );
}

function QuillTask({
  value,
  label,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const quill = new Quill(host, {
      theme: "bubble",
      placeholder,
      modules: {
        toolbar: { container: [["bold", "link"]] },
      },
    });
    quill.clipboard.dangerouslyPasteHTML(taskToEditorHtml(value));
    const length = Math.max(0, quill.getLength() - 1);
    quill.setSelection(length, 0);
    quill.focus();

    const keyboard = quill.getModule("keyboard") as {
      addBinding: (binding: { key: string; shortKey?: boolean }, handler: (range: { index: number; length: number }) => boolean) => void;
    };
    // Quill already bolds on Ctrl+B. Ctrl+K opens the same link tooltip as the bubble button.
    keyboard.addBinding({ key: "k", shortKey: true }, (range) => {
      const tooltip = (quill.theme as { tooltip?: LinkTooltip }).tooltip;
      if (!tooltip || range.length === 0) return false;
      const preview = quill.getText(range.index, range.length).trim();
      const href = preview.startsWith("www.") ? `https://${preview}` : preview;
      tooltip.edit("link", href);
      return false;
    });
    keyboard.addBinding({ key: "Enter" }, () => {
      finish();
      return false;
    });

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      linkifyEditor(quill);
      const next = taskFromEditorHtml(quill.getSemanticHTML());
      commitRef.current(next);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && host.contains(next)) return;
      window.setTimeout(() => {
        if (closed) return;
        const active = document.activeElement;
        if (active && host.contains(active)) return;
        const tooltip = host.querySelector(".ql-tooltip");
        const input = tooltip?.querySelector("input");
        // Clicking away while the link box is open should keep the address they typed.
        if (tooltip?.classList.contains("ql-editing") && input instanceof HTMLInputElement && input.value.trim()) {
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
        finish();
      }, 0);
    };
    host.addEventListener("focusout", onFocusOut);
    return () => {
      closed = true;
      host.removeEventListener("focusout", onFocusOut);
    };
    // The open editor keeps what the person is typing. A later reload must not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="task-editor" aria-label={label} />;
}

function linkifyEditor(quill: Quill): void {
  const text = quill.getText();
  const pattern = /(?:https?:\/\/|www\.)[^\s]+/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const raw = match[0].replace(/[),.;:!?]+$/, "");
    if (raw.length < 4) continue;
    const formats = quill.getFormat(start, raw.length);
    if (formats.link) continue;
    const href = raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw;
    quill.formatText(start, raw.length, "link", href, "silent");
  }
}
