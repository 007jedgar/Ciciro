"use client";

import { STANCE_LABELS } from "@/lib/knowledge-view";
import { KNOWLEDGE_STANCES, parseKnowledgeStance, type KnowledgeStance } from "@/lib/knowledge-ledger";

// The four stances as a badge and as a picker, shared by the Knowledge screen,
// the character file's ledger box, and What changed.

export function StancePill({ stance }: { stance: KnowledgeStance }) {
  return <span className={`pill stance-${stance}`}>{STANCE_LABELS[stance]}</span>;
}

export function StanceSelect({
  value,
  onChange,
  disabled,
}: {
  value: KnowledgeStance;
  onChange: (stance: KnowledgeStance) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Stance"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseKnowledgeStance(e.target.value) ?? "knows")}
    >
      {KNOWLEDGE_STANCES.map((stance) => (
        <option key={stance} value={stance}>
          {STANCE_LABELS[stance]}
        </option>
      ))}
    </select>
  );
}
