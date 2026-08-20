import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { fetchMe, fetchPrivate, fetchPublic, readSession } from "./api";
import type { Edge, Mod, PublicData } from "./types";

export function usePublic() {
  return useQuery({ queryKey: ["public"], queryFn: fetchPublic });
}

export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: readSession() !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Admin-only payload: never requested without a session, so players never see it. */
export function usePrivate() {
  const session = useSession();
  return useQuery({
    queryKey: ["private"],
    queryFn: fetchPrivate,
    enabled: Boolean(session.data),
    retry: false,
  });
}

export function useInvalidateData() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ["public"] });
    void client.invalidateQueries({ queryKey: ["private"] });
  }, [client]);
}

export interface Index {
  bySlug: Map<string, Mod>;
  incoming: Map<string, Edge[]>;
  outgoing: Map<string, Edge[]>;
}

export function indexOf(data: PublicData): Index {
  const bySlug = new Map(data.mods.map((mod) => [mod.slug, mod]));
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const edge of data.edges) {
    if (edge.to) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  return { bySlug, incoming, outgoing };
}
