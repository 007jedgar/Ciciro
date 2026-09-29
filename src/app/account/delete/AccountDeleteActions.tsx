"use client";

import { useState } from "react";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";
import { EXPORT_URL } from "@/lib/account/copy";

export default function AccountDeleteActions({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="account-delete-actions">
      <a className="btn" href={EXPORT_URL} download>
        Export my data
      </a>
      <button type="button" className="btn danger" onClick={() => setOpen(true)}>
        Delete my account…
      </button>
      <DeleteAccountDialog
        open={open}
        email={email}
        hasPassword={hasPassword}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
