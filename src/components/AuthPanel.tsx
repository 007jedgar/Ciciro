import type { FormEvent, ReactNode } from "react";
import BrandMark from "@/components/BrandMark";

/**
 * The centered card the sign-in pages share (login, signup, forgot and reset
 * password, email verification). A form when given `onSubmit`.
 */
export default function AuthPanel({
  title,
  children,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const body = (
    <>
      <BrandMark size={56} />
      <h1>{title}</h1>
      {children}
    </>
  );
  return (
    <div className="auth-wrap">
      {onSubmit ? (
        <form className="auth-card" onSubmit={onSubmit}>
          {body}
        </form>
      ) : (
        <div className="auth-card">{body}</div>
      )}
    </div>
  );
}
