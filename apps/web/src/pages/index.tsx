import { useEffect } from "react";
import { useRouter } from "next/router";

/** Middleware normally redirects before this renders; belt-and-braces. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/boards");
  }, [router]);
  return null;
}
