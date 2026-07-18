-- Migration 002 — table de persistance des sessions utilisateur.
-- Adossée à express-session via un store maison (server/db/session-store.js).
-- Nommée session_store (et non "sessions") pour ne pas entrer en collision avec la table
-- métier `sessions` (séances d'entraînement, migration 001).

CREATE TABLE session_store (
  sid    TEXT PRIMARY KEY,        -- identifiant de session généré par express-session
  data   TEXT NOT NULL,           -- session sérialisée en JSON
  expire INTEGER NOT NULL         -- expiration en epoch millisecondes
);
CREATE INDEX idx_session_store_expire ON session_store(expire);
