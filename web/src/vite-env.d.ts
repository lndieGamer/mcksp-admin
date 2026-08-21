/// <reference types="vite/client" />

// Neither layout extension ships types; they are registered for their side
// effect and only referenced by name in the layout options.
declare module "cytoscape-dagre";
declare module "cytoscape-fcose";

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
