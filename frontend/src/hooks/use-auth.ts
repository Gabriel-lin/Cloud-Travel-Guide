import { useInitAuth } from "@/hooks/use-init-auth";
import { useInitSettings } from "@/hooks/use-init-settings";
import { selectIsAuthenticated, useAuthStore } from "@/store";

export function useAuth() {
  useInitSettings();
  useInitAuth();

  const ready = useAuthStore((s) => s.ready);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const logout = useAuthStore((s) => s.logout);
  const clearError = useAuthStore((s) => s.clearError);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  return {
    ready,
    status,
    user,
    session,
    error,
    isAuthenticated,
    isLoading: status === "loading",
    login,
    register,
    logout,
    clearError,
  };
}
