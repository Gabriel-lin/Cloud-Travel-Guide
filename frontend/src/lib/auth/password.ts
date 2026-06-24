const REGISTER_PASSWORD_PATTERN = /^[a-zA-Z0-9]+$/;

export type RegisterPasswordIssue =
  | "tooShort"
  | "invalidChars"
  | "missingLower"
  | "missingUpper"
  | "missingDigit";

export function getRegisterPasswordIssue(
  password: string,
): RegisterPasswordIssue | null {
  if (password.length < 6) return "tooShort";
  if (!REGISTER_PASSWORD_PATTERN.test(password)) return "invalidChars";
  if (!/[a-z]/.test(password)) return "missingLower";
  if (!/[A-Z]/.test(password)) return "missingUpper";
  if (!/\d/.test(password)) return "missingDigit";
  return null;
}

export function isValidRegisterPassword(password: string): boolean {
  return getRegisterPasswordIssue(password) === null;
}
