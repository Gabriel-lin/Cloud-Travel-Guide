import { Suspense } from "react";

import { LoginPageContent } from "@/components/auth/LoginPageContent";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
