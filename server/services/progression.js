// Service de progression DDP (dynamic double progression). Implémente la procédure de décision
// de docs/progression-algo.md §5 (cas A→G2, dans l'ordre, le premier qui s'applique gagne),
// la variante force §7 et le mode dégradé §8. Les seuils globaux viennent de config.yml
// (progression.*), jamais codés en dur.
//
// Séparation nette : `decideSet` et `suggestExercise` sont PURES (paramètres + historique en
// entrée, aucune base) pour être testables case par case sur des historiques fabriqués.
// `getExerciseHistory` est la SEULE fonction impure (la requête SQL), isolée à part.

// Arrondit une charge au pas réalisable. `step` = load_rounding_step (config) ou, à défaut,
// l'incrément de l'exercice. N'intervient qu'au deload (seul calcul non aligné sur l'incrément).
function round(x, step) {
  const s = step > 0 ? step : 1;
  return Math.round(x / s) * s;
}

// Stagnation (cas C) : les `n` occurrences les plus récentes de cette série ont exactement la même
// charge ET les mêmes reps. Exige au moins `n` occurrences (sinon pas assez d'historique pour juger).
function isStalled(lastSets, n) {
  if (lastSets.length < n) return false;
  const ref = lastSets[0];
  for (let i = 1; i < n; i++) {
    if (lastSets[i].load !== ref.load || lastSets[i].reps !== ref.reps) return false;
  }
  return true;
}

// Décision pour UNE série (un set_number). PURE.
// - param : { rep_min, rep_max, rir_cible, increment } de la routine_exercise.
// - lastSets : occurrences passées de CETTE même série (même set_number), la plus récente d'abord.
// - goal : 'hypertrophy' | 'strength'.
// - thresholds : { easy_delta, deload_pct, stall_sessions, load_rounding_step }.
// - prevLoad : charge suggérée de la série précédente (set_number - 1), pour le cas A.
// Retourne { suggested_load, suggested_reps, reason, degraded? }. `degraded` n'est posé que si le
// RIR manque ET qu'une garde RIR a été sautée (cf §8) — jamais sur les cas B/C qui ignorent le RIR.
function decideSet(param, lastSets, goal, thresholds, prevLoad) {
  const { rep_min, rep_max, rir_cible, increment } = param;
  const { easy_delta, deload_pct, stall_sessions, load_rounding_step } = thresholds;
  const step = load_rounding_step || increment;
  const isStrength = goal === "strength";
  const last = lastSets[0] || null;

  // A — pas d'historique pour cette série (premier passage, ou série nouvellement ajoutée).
  if (!last) {
    // Point de départ : la charge de la série précédente si elle existe, sinon saisie manuelle.
    return { suggested_load: prevLoad ?? null, suggested_reps: null, reason: "baseline" };
  }

  const deload = () => ({
    suggested_load: round(last.load * (1 - deload_pct), step),
    suggested_reps: rep_min,
    reason: "deload",
  });

  // B — échec : en dessous du bas de fourchette.
  if (last.reps < rep_min) return deload();

  // C — stagnation : plusieurs séances identiques d'affilée.
  if (isStalled(lastSets, stall_sessions)) return deload();

  const hasRir = last.rir !== null && last.rir !== undefined;

  // D — charge trop légère : RIR très au-dessus de la cible (nécessite un RIR loggé).
  if (hasRir && last.rir >= rir_cible + easy_delta) {
    return {
      suggested_load: last.load + increment,
      suggested_reps: rep_min,
      reason: "increase_load_easy",
    };
  }

  // E / F — au sommet de la fourchette.
  if (last.reps >= rep_max) {
    // Montée de charge si : force (§7, garde RIR levée), ou RIR ≥ cible (E), ou RIR manquant (§8).
    if (isStrength || (hasRir && last.rir >= rir_cible) || !hasRir) {
      const out = {
        suggested_load: last.load + increment,
        suggested_reps: rep_min,
        reason: "increase_load",
      };
      if (!hasRir) out.degraded = true; // garde RIR sautée faute de donnée
      return out;
    }
    // F — hypertrophie, RIR trop élevé : consolider au sommet.
    return { suggested_load: last.load, suggested_reps: rep_max, reason: "hold" };
  }

  // G1 / G2 — dans la fourchette (rep_min ≤ reps < rep_max).
  // Gain d'une rep si : force (§7, +1 rep systématique), ou RIR ≥ cible (G1), ou RIR manquant (§8).
  if (isStrength || (hasRir && last.rir >= rir_cible) || !hasRir) {
    const out = {
      suggested_load: last.load,
      suggested_reps: Math.min(last.reps + 1, rep_max),
      reason: "increase_reps",
    };
    if (!hasRir) out.degraded = true;
    return out;
  }
  // G2 — hypertrophie, RIR trop élevé : maintenir.
  return { suggested_load: last.load, suggested_reps: last.reps, reason: "hold" };
}

// Calcule les suggestions d'un exercice, une par set_number (1..n_series). PURE.
// - param : routine_exercise complète (dont n_series, goal).
// - sessions : historique groupé par séance, la plus récente d'abord, chaque séance = { sets: [...] }.
//   Chaque set : { set_number, reps, load, rir }.
// Thread la charge suggérée de la série précédente vers le cas A (point de départ).
function suggestExercise(param, sessions, thresholds) {
  const suggestions = [];
  let prevLoad = null;
  for (let sn = 1; sn <= param.n_series; sn++) {
    // Occurrences de CETTE série (même set_number) dans chaque séance, plus récente d'abord.
    // Les séances où ce set_number n'existait pas (moins de séries) sont ignorées (§4).
    const lastSets = sessions
      .map((sess) => sess.sets.find((s) => s.set_number === sn))
      .filter((s) => s !== undefined);

    const d = decideSet(param, lastSets, param.goal, thresholds, prevLoad);
    suggestions.push({ set_number: sn, ...d });
    // La série suivante sans historique démarrera sur la charge de celle-ci (si définie).
    if (d.suggested_load !== null && d.suggested_load !== undefined) prevLoad = d.suggested_load;
  }
  return suggestions;
}

// SEULE fonction impure : historique des séries loggées de l'utilisateur pour cet exercice.
// Restreint aux séances CLÔTURÉES ('completed') : une séance in_progress en cours de saisie ne doit
// pas devenir « la dernière fois » et faire recalculer la suggestion sur ce qu'on vient de logger
// (l'algo compare à la séance précédente, pas à l'instant présent). Retourne les séances groupées,
// la plus récente d'abord, chacune { sets: [{ set_number, reps, load, rir }] }.
function getExerciseHistory(db, userId, exerciseId) {
  const rows = db
    .prepare(
      `SELECT ls.session_id, s.started_at, ls.set_number, ls.reps, ls.load, ls.rir
       FROM logged_sets ls
       JOIN sessions s ON s.id = ls.session_id
       WHERE s.user_id = ? AND ls.exercise_id = ? AND s.status = 'completed'
       ORDER BY s.started_at DESC, ls.set_number ASC`
    )
    .all(userId, exerciseId);

  // Groupe par séance en préservant l'ordre started_at DESC (première occurrence d'un session_id
  // = séance la plus récente rencontrée).
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, { sets: [] });
    bySession.get(r.session_id).sets.push({
      set_number: r.set_number,
      reps: r.reps,
      load: r.load,
      rir: r.rir,
    });
  }
  return [...bySession.values()];
}

module.exports = { round, isStalled, decideSet, suggestExercise, getExerciseHistory };
