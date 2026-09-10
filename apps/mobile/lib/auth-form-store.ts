import { create } from "zustand";
import { validateAuthFields, type AuthFieldErrors, type AuthMode } from "./auth-form";

type AuthFormState = {
  name: string;
  email: string;
  password: string;
  errors: AuthFieldErrors;
  setName: (name: string) => void;
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
  /** Revalidates the current fields against `mode`, stores the errors, and reports validity. */
  validate: (mode: AuthMode) => boolean;
  reset: () => void;
};

const emptyFields = { name: "", email: "", password: "", errors: {} as AuthFieldErrors };

export const useAuthFormStore = create<AuthFormState>((set, get) => ({
  ...emptyFields,
  setName: (name) => set({ name }),
  setEmail: (email) => set((s) => ({ email, errors: { ...s.errors, email: undefined } })),
  setPassword: (password) => set((s) => ({ password, errors: { ...s.errors, password: undefined } })),
  validate: (mode) => {
    const { email, password } = get();
    const errors = validateAuthFields(mode, { email, password });
    set({ errors });
    return Object.keys(errors).length === 0;
  },
  reset: () => set(emptyFields),
}));
