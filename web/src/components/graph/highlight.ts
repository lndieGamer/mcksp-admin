/** Подсветка цепочки живёт вне React-состояния страницы.
 *
 *  Наивный вариант — положить состояние в `data` каждого узла — означает, что
 *  на каждое движение мыши пересобираются все 146 узлов и 84 ребра, React Flow
 *  их диффит, а React перерисовывает. Именно это давало p95 в 100мс на
 *  наведении.
 *
 *  Здесь массив узлов не меняется вообще. Подписка отдаёт один булев флаг на
 *  элемент, поэтому перерисовываются только те, кто реально сменил состояние —
 *  это ~10 узлов цепочки вместо двух сотен. Приглушение остальных делает CSS
 *  по атрибуту на контейнере (см. `.graphfield` в index.css): для этого React
 *  не нужен совсем. */

import { useSyncExternalStore } from "react";

export interface Highlight {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

let current: Highlight | null = null;
const listeners = new Set<() => void>();

export function setHighlight(next: Highlight | null): void {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLit(id: string, kind: "nodes" | "edges"): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (current ? current[kind].has(id) : false),
    () => false,
  );
}
