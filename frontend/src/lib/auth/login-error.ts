import { ApiError } from "@/service/base";

type LoginErrorTranslator = (key: string) => string;

/** 将登录接口错误映射为本地化提示文案 */
export function getLoginErrorMessage(
  error: unknown,
  t: LoginErrorTranslator,
): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return t("auth.userNotRegistered");
    }
    if (error.status === 401) {
      return t("auth.incorrectPassword");
    }
  }

  return t("auth.loginFailed");
}
