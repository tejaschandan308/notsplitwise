import { notFound } from "next/navigation";
import { DevTools } from "./dev-tools";

/**
 * Temporary debugging screen for local development (it can call the real
 * parse API). Production builds answer 404 here.
 */
export default function DevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevTools />;
}
