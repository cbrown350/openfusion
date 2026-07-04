// Attachment chips + file picker for the Playground composer.
//
// Owns the hidden <input type="file"> and renders the chip row. Reading files into text
// (text vs PDF dispatch) happens in the parent via onAttach, so this component stays
// presentational + a thin input wrapper. An attachment in the error state (e.g. unreadable
// PDF) still renders as a chip so the user can see what failed and remove it.

import { useRef } from "react";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  text: string;
  error?: string;
}

export function ComposerAttachments({
  attachments,
  disabled,
  onPick,
  onRemove,
}: {
  attachments: Attachment[];
  disabled?: boolean;
  onPick: (files: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1.5">
      {attachments.map((a) => (
        <span key={a.id} className={`chip ${a.error ? "is-error" : ""}`} title={a.error ?? a.name}>
          {a.error ? (
            <span className="name text-red-300">{a.name} (unreadable)</span>
          ) : (
            <span className="name text-white/85">{a.name}</span>
          )}
          <button
            type="button"
            className="x"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.id)}
            disabled={disabled}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ))}

      <button
        type="button"
        className="btn-icon"
        title="Attach text or PDF files (content is added to the fusion context)"
        aria-label="Attach files"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5V19a2 2 0 0 1-2 2H7l-4-4 11-11a2.121 2.121 0 0 1 3 3l-9 9" />
        </svg>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".txt,.md,.json,.csv,.log,.pdf,text/*"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onPick(e.target.files);
          // Reset so picking the same file twice fires change again.
          e.target.value = "";
        }}
      />
    </div>
  );
}
