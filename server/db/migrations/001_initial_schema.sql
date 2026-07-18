-- Migration 001 — schéma initial complet de Sthenos.
-- Reflète docs/data-model.md. Tables, contraintes et index.
-- Note : PRAGMA foreign_keys est activé par connexion dans server/db/index.js, pas ici.

-- 2.1 users — identité et authentification (deux lignes attendues).
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  username            TEXT NOT NULL UNIQUE,          -- identifiant de connexion
  password_hash       TEXT NOT NULL,                 -- mot de passe haché (bcrypt)
  health_ingest_token TEXT UNIQUE,                   -- jeton Bearer d'ingestion Apple Santé (NULL possible)
  created_at          TEXT NOT NULL                  -- ISO 8601 UTC
);

-- 2.2 user_settings — préférences runtime, 1-1 avec users. Amorcées depuis config.yml à la création.
CREATE TABLE user_settings (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id),
  theme             TEXT NOT NULL DEFAULT 'dark',    -- thème d'interface
  weight_unit       TEXT NOT NULL DEFAULT 'kg',      -- unité de charge
  default_rir       INTEGER NOT NULL,                -- RIR cible par défaut des nouveaux exercices
  default_rep_min   INTEGER NOT NULL,                -- bas de fourchette par défaut
  default_rep_max   INTEGER NOT NULL,                -- haut de fourchette par défaut
  default_increment REAL NOT NULL                    -- incrément de charge par défaut
);

-- 2.3 exercises — dataset importé, lecture seule après import (cf docs/exercise-dataset.md).
CREATE TABLE exercises (
  id                TEXT PRIMARY KEY,                -- identifiant du dataset (ex. "0001")
  name              TEXT NOT NULL,                   -- nom (anglais)
  category          TEXT NOT NULL,                   -- partie du corps (filtre catalogue)
  equipment         TEXT NOT NULL,                   -- équipement (filtre catalogue)
  target            TEXT,                            -- muscle cible principal
  muscle_group      TEXT,                            -- groupe synergiste
  secondary_muscles TEXT,                            -- muscles secondaires, JSON texte
  instructions_en   TEXT,                            -- instructions (anglais)
  image             TEXT NOT NULL,                   -- chemin de la vignette JPG
  gif_url           TEXT NOT NULL                    -- chemin de l'animation GIF
);
CREATE INDEX idx_exercises_category ON exercises(category);
CREATE INDEX idx_exercises_equipment ON exercises(equipment);

-- 2.4 routines — séances-types construites par un utilisateur.
CREATE TABLE routines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,                          -- ex. « Push »
  created_at TEXT NOT NULL
);

-- 2.5 routine_exercises — exercices d'une routine et paramètres de progression.
CREATE TABLE routine_exercises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id   INTEGER NOT NULL REFERENCES routines(id),
  exercise_id  TEXT NOT NULL REFERENCES exercises(id),
  position     INTEGER NOT NULL,                     -- ordre dans la séance
  n_series     INTEGER NOT NULL,                     -- nombre de séries de travail
  rep_min      INTEGER NOT NULL,                     -- bas de fourchette
  rep_max      INTEGER NOT NULL,                     -- haut de fourchette
  rir_cible    INTEGER NOT NULL,                     -- RIR visé
  increment    REAL NOT NULL,                        -- pas de charge
  goal         TEXT NOT NULL DEFAULT 'hypertrophy'   -- 'hypertrophy' ou 'strength'
                 CHECK (goal IN ('hypertrophy', 'strength')),
  rest_seconds INTEGER                               -- temps de repos indicatif (NULL possible)
);

-- 2.6 sessions — séance réalisée. Identifiant généré côté client (idempotence hors-ligne).
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                       -- UUID client
  user_id    INTEGER NOT NULL REFERENCES users(id),
  routine_id INTEGER REFERENCES routines(id),        -- routine source (NULL possible)
  started_at TEXT NOT NULL,
  ended_at   TEXT,                                   -- NULL tant que la séance n'est pas finie
  status     TEXT NOT NULL DEFAULT 'in_progress'
               CHECK (status IN ('in_progress', 'completed'))
);

-- 2.7 logged_sets — chaque série loggée. Identifiant généré côté client. Une charge par série (DDP).
CREATE TABLE logged_sets (
  id          TEXT PRIMARY KEY,                      -- UUID client
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  set_number  INTEGER NOT NULL,                      -- numéro de série
  reps        INTEGER NOT NULL,                      -- répétitions réalisées
  load        REAL NOT NULL,                         -- charge (kg)
  rir         INTEGER,                               -- RIR ressenti (NULL possible)
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_logged_sets_session ON logged_sets(session_id);
CREATE INDEX idx_logged_sets_exercise_created ON logged_sets(exercise_id, created_at);

-- 2.8 body_metrics — indicateurs corporels (poids manuel + Apple Santé). Modèle clé-valeur.
CREATE TABLE body_metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  metric_type TEXT NOT NULL,                         -- ex. 'weight', 'resting_hr', 'hrv', 'vo2max'...
  value       REAL NOT NULL,
  unit        TEXT,                                  -- unité (NULL possible)
  recorded_at TEXT NOT NULL,                         -- date de la mesure
  source      TEXT NOT NULL CHECK (source IN ('manual', 'apple_health')),
  -- Idempotence côté santé : une ré-ingestion des mêmes points ne crée pas de doublon.
  UNIQUE (user_id, metric_type, recorded_at, source)
);

-- 2.9 daily_summaries — résultat de l'analyse quotidienne (cron matinal ou recalcul à la demande).
CREATE TABLE daily_summaries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  date         TEXT NOT NULL,                        -- jour couvert
  payload      TEXT NOT NULL,                        -- résumé calculé, JSON
  generated_at TEXT NOT NULL,                        -- horodatage du calcul
  -- Un recalcul remplace le résumé du jour (ON CONFLICT DO UPDATE côté service).
  UNIQUE (user_id, date)
);
