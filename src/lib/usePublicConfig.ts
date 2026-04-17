"use client";

import { useEffect, useState } from "react";
import type { PublicConfig } from "@/lib/public-config";

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;

async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch("/api/public-config", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("public-config fetch failed");
  }
  return (await res.json()) as PublicConfig;
}

export function usePublicConfig(): {
  config: PublicConfig | null;
  error: string | null;
  loading: boolean;
} {
  const [config, setConfig] = useState<PublicConfig | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    let active = true;
    if (cached) return;
    setLoading(true);
    setError(null);

    if (!inflight) {
      inflight = fetchPublicConfig();
    }

    void inflight
      .then((data) => {
        cached = data;
        if (active) {
          setConfig(data);
        }
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (active) {
          setError(message);
        }
      })
      .finally(() => {
        inflight = null;
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { config, error, loading };
}

