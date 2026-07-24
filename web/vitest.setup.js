// Setup global des tests composant.
// - Matchers jest-dom (toBeInTheDocument, toHaveValue…) branchés sur l'expect de vitest.
import "@testing-library/jest-dom/vitest";

// - Filet de sécurité : SetRow appelle crypto.randomUUID() ; selon la version de jsdom, `crypto`
//   n'est pas toujours exposé sur le global. On le pose depuis Node si absent.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto = webcrypto;
}
