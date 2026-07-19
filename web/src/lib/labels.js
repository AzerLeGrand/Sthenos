// Table de correspondance française des libellés du dataset (docs/exercise-dataset.md §6,
// docs/frontend.md §7). Seuls les FILTRES du catalogue — category et equipment — sont traduits :
// ce sont des éléments d'interface. Les noms d'exercices, target et muscle_group restent en
// anglais (contenu). Fichier unique, pas de traductions dispersées dans les composants.
// Un terme non mappé se rabat sur la valeur brute affichée telle quelle.

// Catégories (parties du corps) — 10 valeurs connues du dataset.
const CATEGORIES = {
  "upper arms": "Bras",
  "upper legs": "Cuisses",
  back: "Dos",
  waist: "Abdominaux",
  chest: "Pectoraux",
  shoulders: "Épaules",
  "lower legs": "Mollets",
  "lower arms": "Avant-bras",
  cardio: "Cardio",
  neck: "Cou",
};

// Équipements — 28 valeurs connues du dataset (liste exhaustive au regard des données actuelles).
const EQUIPMENT = {
  "body weight": "Poids du corps",
  dumbbell: "Haltères",
  cable: "Poulie",
  barbell: "Barre",
  "leverage machine": "Machine à levier",
  band: "Élastique",
  "smith machine": "Machine Smith",
  kettlebell: "Kettlebell",
  weighted: "Lesté",
  "stability ball": "Ballon de stabilité",
  "ez barbell": "Barre EZ",
  assisted: "Assisté",
  "sled machine": "Traîneau",
  "medicine ball": "Medicine ball",
  rope: "Corde",
  roller: "Roulette",
  "resistance band": "Bande de résistance",
  "bosu ball": "Bosu",
  "olympic barbell": "Barre olympique",
  "wheel roller": "Roue abdominale",
  "upper body ergometer": "Ergomètre haut du corps",
  "skierg machine": "Machine SkiErg",
  hammer: "Marteau",
  "stationary bike": "Vélo d'appartement",
  tire: "Pneu",
  "trap bar": "Barre hexagonale",
  "elliptical machine": "Vélo elliptique",
  "stepmill machine": "Escalier mécanique",
};

// Traduit une valeur de catégorie ; repli sur la valeur brute si non mappée.
export function categoryLabel(value) {
  return CATEGORIES[value] || value;
}

// Traduit une valeur d'équipement ; repli sur la valeur brute si non mappée.
export function equipmentLabel(value) {
  return EQUIPMENT[value] || value;
}

// Motifs de suggestion DDP (docs/progression-algo.md §3/§10) → libellés courts FR affichés en
// séance. Le front n'implémente aucune règle : il ne fait qu'afficher le `reason` renvoyé.
const REASONS = {
  baseline: "Point de départ",
  deload: "Allège",
  increase_load_easy: "Monte la charge",
  increase_load: "Monte la charge",
  hold: "Maintiens",
  increase_reps: "Gagne une répétition",
};

// Traduit un code de motif ; repli sur le code brut si inconnu (robustesse aux évolutions backend).
export function reasonLabel(code) {
  return REASONS[code] || code;
}
