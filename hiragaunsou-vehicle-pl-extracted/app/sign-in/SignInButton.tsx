"use client";

import { useState } from "react";
import { signInWithGoogle } from "../_lib/authClient";

export function SignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError("サインインに失敗しました。時間をおいて再度お試しください。");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn btn-primary pressable flex items-center gap-3"
      >
        {pending ? "サインインしています…" : "Googleでサインインする"}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
