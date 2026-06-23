"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getActiveTrip } from "@/lib/storage";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let ignore = false;

    async function routeFromLocalState(): Promise<void> {
      const activeTrip = await getActiveTrip();

      if (!ignore) {
        router.replace(activeTrip ? "/capture" : "/trip/new");
      }
    }

    routeFromLocalState();

    return () => {
      ignore = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-foreground/60">Loading...</p>
    </main>
  );
}
