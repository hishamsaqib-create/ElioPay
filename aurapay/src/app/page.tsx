"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (r.ok) router.replace("/dashboard");
      else router.replace("/login");
    });
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-primary-600">
      <div className="text-white text-2xl font-bold animate-pulse">ElioPay™</div>
    </div>
  );
}
