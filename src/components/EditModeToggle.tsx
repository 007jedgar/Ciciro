"use client";

import type { EditMode } from "@/lib/edit-mode";

export const EDIT_MODE_LABELS: Record<EditMode, string> = {
  edits: "Allow edits",
  chat: "Chat only",
};

const HINTS: Record<EditMode, string> = {
  edits: "Ciciro can change your manuscript.",
  chat: "Ciciro answers and discusses but never changes your manuscript.",
};

const MODES: EditMode[] = ["edits", "chat"];

/**
 * The chat's two-state switch between Allow edits and Chat only. It belongs to
 * the conversation (ChatPanel holds it and the server enforces it per turn).
 */
export default function EditModeToggle({
  mode,
  onChange,
}: {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
}) {
  return (
    <div className="edit-mode" role="radiogroup" aria-label="What Ciciro may do in this chat">
      {MODES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          title={HINTS[value]}
          className="edit-mode-option"
          onClick={() => {
            if (mode !== value) onChange(value);
          }}
        >
          {EDIT_MODE_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
