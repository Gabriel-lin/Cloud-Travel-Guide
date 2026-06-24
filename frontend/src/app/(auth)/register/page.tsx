import { Suspense } from "react";

import { LoginPageContent } from "@/components/auth/LoginPageContent";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent mode="register" />
    </Suspense>
  );
}
