// Accès IndexedDB (via `idb`), isolé pour rester une couche fine et remplaçable : la LOGIQUE de file
// vit dans offline-queue.js (testée sans navigateur avec un store mémoire respectant cette interface).
// Deux object stores :
//  - 'queue' : les écritures en attente. keyPath auto-incrément → la clé EST l'ordre d'insertion.
//  - 'cache' : couple clé→valeur pour la consultation hors-ligne (ex. 'routine:3' → détail routine).
// Toutes les opérations sont async et remontent leurs erreurs explicitement (l'appelant décide).
import { openDB } from "idb";

const DB_NAME = "sthenos-offline";
const DB_VERSION = 1;
const QUEUE = "queue";
const CACHE = "cache";

let dbPromise = null;

// Ouvre (une fois) la base et crée les stores au besoin. Mémoïsé pour ne pas rouvrir à chaque appel.
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(QUEUE)) {
          d.createObjectStore(QUEUE, { keyPath: "key", autoIncrement: true });
        }
        if (!d.objectStoreNames.contains(CACHE)) {
          d.createObjectStore(CACHE);
        }
      },
    });
  }
  return dbPromise;
}

// Implémentation réelle du store attendu par offline-queue.js. Chaque entrée reçoit sa clé
// auto-incrément à l'insertion (renvoyée), garantissant l'ordre de rejeu.
export const idbStore = {
  // Ajoute une entrée, retourne sa clé (ordre d'insertion).
  async add(entry) {
    return (await db()).add(QUEUE, entry);
  },
  // Toutes les entrées triées par clé croissante (ordre d'insertion).
  async getAllOrdered() {
    return (await db()).getAll(QUEUE); // getAll parcourt déjà par clé croissante
  },
  // Remplace une entrée existante (met à jour attempts/nextAttemptAt). L'entrée porte sa `key`.
  async update(entry) {
    return (await db()).put(QUEUE, entry);
  },
  // Supprime une entrée par sa clé.
  async remove(key) {
    return (await db()).delete(QUEUE, key);
  },

  // --- Cache clé→valeur (lectures hors-ligne) ---
  async putCache(key, value) {
    return (await db()).put(CACHE, value, key);
  },
  async getCache(key) {
    return (await db()).get(CACHE, key);
  },
};
