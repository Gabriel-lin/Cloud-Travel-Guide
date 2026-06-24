import {
  getRegisterPasswordIssue,
  type RegisterPasswordIssue,
} from "@/lib/auth/password";

type RegisterPasswordTranslator = (key: string) => string;

const ISSUE_I18N_KEY: Record<RegisterPasswordIssue, string> = {
  tooShort: "auth.registerPasswordTooShort",
  invalidChars: "auth.registerPasswordInvalidChars",
  missingLower: "auth.registerPasswordMissingLower",
  missingUpper: "auth.registerPasswordMissingUpper",
  missingDigit: "auth.registerPasswordMissingDigit",
};

export function getRegisterPasswordErrorMessage(
  password: string,
  t: RegisterPasswordTranslator,
): string | null {
  const issue = getRegisterPasswordIssue(password);
  if (!issue) return null;
  return t(ISSUE_I18N_KEY[issue]);
}
