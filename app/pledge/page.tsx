import { Suspense } from "react";
import { PledgeClient } from "./PledgeClient";

export default function PledgePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-ink-mute">
          Loading…
        </div>
      }
    >
      <PledgeClient />
    </Suspense>
  );
}
