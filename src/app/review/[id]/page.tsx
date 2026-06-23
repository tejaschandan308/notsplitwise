"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/app/app-shell";

export default function ReviewPage() {
  const params = useParams<{ id: string }>();

  return (
    <AppShell>
      <section className="pt-8">
        <h1 className="text-3xl font-semibold">Review</h1>
        <p className="mt-3 text-sm text-foreground/65">
          Stub for reviewing expense {params.id}.
        </p>
      </section>
    </AppShell>
  );
}
