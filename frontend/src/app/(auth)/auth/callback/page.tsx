import { Suspense } from "react";

import { AuthCallbackContent } from "@/components/auth/AuthCallbackContent";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackContent />
    </Suspense>
  );
}
