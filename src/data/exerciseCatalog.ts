import { ExerciseItem, MuscleGroup, MovementPattern } from '../types/workout';

export const EXERCISE_CATALOG: ExerciseItem[] = [
  // ========================================================
  // 1. PECHO & EMPUJE HORIZONTAL
  // ========================================================
  {
    id: 'barbell_bench_press',
    name: 'Press de Banca Plano con Barra',
    muscleGroup: 'pecho',
    secondaryMuscles: ['triceps', 'hombros'],
    movementPattern: 'empuje_horizontal',
    equipment: 'barra',
    instructions: [
      'Apoya los pies firmes en el suelo y genera retracción escapular activa en el banco.',
      'Baja la barra de forma controlada (fase excéntrica de 2-3 s) hasta rozar el tercio inferior del esternón.',
      'Empuja con fuerza explosiva siguiendo una trayectoria suave en J invertida sin perder la estabilidad escapular.',
    ],
    variants: ['dumbbell_bench_press', 'machine_chest_press', 'weighted_dips'],
  },
  {
    id: 'dumbbell_bench_press',
    name: 'Press Plano con Mancuernas',
    muscleGroup: 'pecho',
    secondaryMuscles: ['triceps', 'hombros'],
    movementPattern: 'empuje_horizontal',
    equipment: 'mancuerna',
    instructions: [
      'Permite mayor libertad en la articulación del hombro y convergencia natural en el punto álgido.',
      'Controla el descenso profundo asegurando una buena apertura torácica sin hiperextensión articular.',
    ],
    variants: ['barbell_bench_press', 'machine_chest_press'],
  },
  {
    id: 'incline_dumbbell_press',
    name: 'Press Inclinado con Mancuernas (30°)',
    muscleGroup: 'pecho',
    secondaryMuscles: ['hombros', 'triceps'],
    movementPattern: 'empuje_horizontal',
    equipment: 'mancuerna',
    instructions: [
      'Ajusta el banco entre 30° y 45° para enfatizar el haz clavicular del pectoral mayor.',
      'Mantén los codos a unos 45°-60° respecto al torso durante todo el recorrido.',
    ],
    variants: ['incline_barbell_press', 'machine_chest_press'],
  },
  {
    id: 'incline_barbell_press',
    name: 'Press de Banca Inclinado con Barra',
    muscleGroup: 'pecho',
    secondaryMuscles: ['hombros', 'triceps'],
    movementPattern: 'empuje_horizontal',
    equipment: 'barra',
    instructions: [
      'Mantén tensión constante en el haz clavicular y una base plantar estable.',
    ],
    variants: ['incline_dumbbell_press'],
  },
  {
    id: 'weighted_dips',
    name: 'Fondos en Paralelas (Enfoque Pectoral)',
    muscleGroup: 'pecho',
    secondaryMuscles: ['triceps', 'hombros'],
    movementPattern: 'empuje_horizontal',
    equipment: 'peso_corporal',
    instructions: [
      'Inclina el torso ligeramente hacia adelante y separa levemente los codos para solicitar el pectoral inferior.',
      'Desciende hasta alcanzar al menos los 90° de flexión en el codo de forma controlada.',
    ],
    variants: ['barbell_bench_press', 'machine_chest_press'],
  },
  {
    id: 'machine_chest_press',
    name: 'Press de Pecho en Máquina Convergente',
    muscleGroup: 'pecho',
    secondaryMuscles: ['triceps', 'hombros'],
    movementPattern: 'empuje_horizontal',
    equipment: 'maquina',
    instructions: [
      'Excelente estabilidad para reclutamiento mecánico estricto hasta el fallo muscular seguro.',
    ],
    variants: ['barbell_bench_press', 'dumbbell_bench_press'],
  },
  {
    id: 'cable_chest_flyes',
    name: 'Cruces de Pecho en Polea Media',
    muscleGroup: 'pecho',
    secondaryMuscles: ['hombros'],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Tensión constante en aducción horizontal del brazo; aprieta 1 segundo en contracción máxima.',
    ],
    variants: ['machine_pec_deck'],
  },
  {
    id: 'machine_pec_deck',
    name: 'Aperturas en Máquina Contractora (Pec Deck)',
    muscleGroup: 'pecho',
    secondaryMuscles: ['hombros'],
    movementPattern: 'aislamiento',
    equipment: 'maquina',
    instructions: [
      'Ajusta la altura del sillín para que los brazos queden paralelos al suelo en la trayectoria media.',
    ],
    variants: ['cable_chest_flyes'],
  },

  // ========================================================
  // 2. ESPALDA & TRACCIÓN HORIZONTAL
  // ========================================================
  {
    id: 'pendlay_barbell_row',
    name: 'Remo con Barra Pendlay (90°)',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps', 'core'],
    movementPattern: 'traccion_horizontal',
    equipment: 'barra',
    instructions: [
      'Torso estrictamente paralelo al suelo, cada repetición parte de parada muerta en el piso.',
      'Tracciona con los dorsales y romboides sin balanceo lumbar compensatorio.',
    ],
    variants: ['chest_supported_tbar_row', 'single_arm_dumbbell_row'],
  },
  {
    id: 'single_arm_dumbbell_row',
    name: 'Remo con Mancuerna Unilateral',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps', 'hombros'],
    movementPattern: 'traccion_horizontal',
    equipment: 'mancuerna',
    instructions: [
      'Permite corregir asimetrías y maximizar el rango de recorrido llevando el codo hacia la cadera.',
    ],
    variants: ['pendlay_barbell_row', 'cable_seated_row'],
  },
  {
    id: 'cable_seated_row',
    name: 'Remo en Polea Baja Sentado (Agarre Neutro)',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps'],
    movementPattern: 'traccion_horizontal',
    equipment: 'polea',
    instructions: [
      'Mantén el pecho erguido, proyecta los codos hacia atrás y retrae las escápulas en la contracción.',
    ],
    variants: ['pendlay_barbell_row', 'chest_supported_tbar_row'],
  },
  {
    id: 'chest_supported_tbar_row',
    name: 'Remo en Barra T con Pecho Apoyado',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps'],
    movementPattern: 'traccion_horizontal',
    equipment: 'maquina',
    instructions: [
      'Elimina la fatiga de los erectores espinales, permitiendo máxima sobrecarga en la musculatura dorsal.',
    ],
    variants: ['pendlay_barbell_row', 'cable_seated_row'],
  },

  // ========================================================
  // 3. ESPALDA & TRACCIÓN VERTICAL
  // ========================================================
  {
    id: 'pull_ups_neutral',
    name: 'Dominadas con Agarre Neutro / Prono',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps', 'core'],
    movementPattern: 'traccion_vertical',
    equipment: 'peso_corporal',
    instructions: [
      'Extiende por completo los brazos al inicio para estiramiento dorsal completo.',
      'Tracciona liderando con el pecho hacia la barra hasta superar la barbilla.',
    ],
    variants: ['lat_pulldown_wide'],
  },
  {
    id: 'lat_pulldown_wide',
    name: 'Jalón al Pecho en Polea Alta',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps'],
    movementPattern: 'traccion_vertical',
    equipment: 'polea',
    instructions: [
      'Torso levemente inclinado hacia atrás (10-15°); tracciona hacia las clavículas con codos apuntando al suelo.',
    ],
    variants: ['pull_ups_neutral'],
  },
  {
    id: 'close_grip_lat_pulldown',
    name: 'Jalón en Polea Alta con Agarre Cerrado Neutro',
    muscleGroup: 'espalda',
    secondaryMuscles: ['biceps'],
    movementPattern: 'traccion_vertical',
    equipment: 'polea',
    instructions: [
      'Enfocado en las fibras iliocostales del dorsal ancho con trayectoria cerrada pegada al cuerpo.',
    ],
    variants: ['lat_pulldown_wide'],
  },

  // ========================================================
  // 4. HOMBROS (DELTOIDES ANTERIOR, LATERAL, POSTERIOR)
  // ========================================================
  {
    id: 'standing_overhead_press',
    name: 'Press Militar de Pie con Barra (OHP)',
    muscleGroup: 'hombros',
    secondaryMuscles: ['triceps', 'core'],
    movementPattern: 'empuje_vertical',
    equipment: 'barra',
    instructions: [
      'Glúteos y abdomen fuertemente contraídos para proteger la zona lumbar.',
      'Empuja la barra verticalmente pasando justo frente al rostro y bloquea sobre la cabeza alineado a la columna.',
    ],
    variants: ['seated_dumbbell_shoulder_press'],
  },
  {
    id: 'seated_dumbbell_shoulder_press',
    name: 'Press de Hombros Sentado con Mancuernas',
    muscleGroup: 'hombros',
    secondaryMuscles: ['triceps'],
    movementPattern: 'empuje_vertical',
    equipment: 'mancuerna',
    instructions: [
      'Respaldo a unos 75-80°; desciende las mancuernas hasta el nivel de las orejas con control estricto.',
    ],
    variants: ['standing_overhead_press'],
  },
  {
    id: 'cable_lateral_raises',
    name: 'Elevaciones Laterales en Polea (Aislamiento)',
    muscleGroup: 'hombros',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Polea fijada a la altura de la muñeca o rodilla; perfil de resistencia continuo en el deltoides lateral.',
    ],
    variants: ['dumbbell_lateral_raises'],
  },
  {
    id: 'dumbbell_lateral_raises',
    name: 'Elevaciones Laterales con Mancuernas',
    muscleGroup: 'hombros',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'mancuerna',
    instructions: [
      'Eleva en el plano escapular (30° hacia adelante respecto al plano frontal) sin balanceo de cadera.',
    ],
    variants: ['cable_lateral_raises'],
  },
  {
    id: 'rear_delt_reverse_flyes_cable',
    name: 'Pájaros para Deltoides Posterior en Polea',
    muscleGroup: 'hombros',
    secondaryMuscles: ['espalda'],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Abre los brazos en horizontal manteniendo una ligera flexión de codo constante; aísla el deltoides posterior.',
    ],
    variants: ['face_pull_cable'],
  },
  {
    id: 'face_pull_cable',
    name: 'Face Pull en Polea con Cuerda',
    muscleGroup: 'hombros',
    secondaryMuscles: ['espalda'],
    movementPattern: 'traccion_horizontal',
    equipment: 'polea',
    instructions: [
      'Tira de la cuerda hacia la frente/ojos con rotación externa final de hombros.',
    ],
    variants: ['rear_delt_reverse_flyes_cable'],
  },

  // ========================================================
  // 5. BÍCEPS & TRÍCEPS
  // ========================================================
  {
    id: 'ez_bar_bicep_curl',
    name: 'Curl de Bíceps con Barra EZ de Pie',
    muscleGroup: 'biceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'barra',
    instructions: [
      'Codos pegados a los costados sin adelantamiento temprano ni inercia lumbar.',
    ],
    variants: ['dumbbell_incline_curl', 'cable_bayesian_curl'],
  },
  {
    id: 'dumbbell_incline_curl',
    name: 'Curl Inclinado en Banco con Mancuernas',
    muscleGroup: 'biceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'mancuerna',
    instructions: [
      'Banco a 45-60°; estiramiento pasivo profundo de la cabeza larga del bíceps.',
    ],
    variants: ['cable_bayesian_curl', 'ez_bar_bicep_curl'],
  },
  {
    id: 'cable_bayesian_curl',
    name: 'Curl Bayesiano en Polea Trasera',
    muscleGroup: 'biceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'De espaldas a la polea baja; máxima tensión en posición de máximo alargamiento muscular.',
    ],
    variants: ['dumbbell_incline_curl'],
  },
  {
    id: 'hammer_curl_dumbbells',
    name: 'Curl Martillo con Mancuernas',
    muscleGroup: 'biceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'mancuerna',
    instructions: [
      'Agarre neutro; recluta braquial anterior y braquiorradial para grosor del brazo.',
    ],
    variants: ['ez_bar_bicep_curl'],
  },
  {
    id: 'triceps_rope_pushdown',
    name: 'Extensiones de Tríceps en Polea Alta con Cuerda',
    muscleGroup: 'triceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Abre la cuerda al final del recorrido para contraer la cabeza lateral y medial.',
    ],
    variants: ['overhead_cable_triceps_extension', 'skull_crushers_ez_bar'],
  },
  {
    id: 'overhead_cable_triceps_extension',
    name: 'Extensiones de Tríceps sobre la Cabeza en Polea',
    muscleGroup: 'triceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Énfasis directo en la cabeza larga del tríceps en posición estirada.',
    ],
    variants: ['triceps_rope_pushdown', 'skull_crushers_ez_bar'],
  },
  {
    id: 'skull_crushers_ez_bar',
    name: 'Press Francés con Barra EZ en Banco Plano',
    muscleGroup: 'triceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'barra',
    instructions: [
      'Desciende la barra hacia la coronilla o detrás de la cabeza para proteger los codos.',
    ],
    variants: ['overhead_cable_triceps_extension'],
  },

  // ========================================================
  // 6. CUÁDRICEPS
  // ========================================================
  {
    id: 'barbell_back_squat',
    name: 'Sentadilla Trasera con Barra (Barra Alta)',
    muscleGroup: 'cuadriceps',
    secondaryMuscles: ['gluteos', 'core'],
    movementPattern: 'sentadilla',
    equipment: 'barra',
    instructions: [
      'Pies al ancho de hombros, rompe en cadera y rodillas de forma coordinada.',
      'Desciende hasta que la cadera baje de la línea de las rodillas (profundidad válida).',
    ],
    variants: ['front_squat_barbell', 'leg_press_45', 'hack_squat_machine'],
  },
  {
    id: 'front_squat_barbell',
    name: 'Sentadilla Frontal con Barra',
    muscleGroup: 'cuadriceps',
    secondaryMuscles: ['core', 'gluteos'],
    movementPattern: 'sentadilla',
    equipment: 'barra',
    instructions: [
      'Barra apoyada en deltoides anteriores; torso completamente erguido.',
    ],
    variants: ['barbell_back_squat', 'hack_squat_machine'],
  },
  {
    id: 'hack_squat_machine',
    name: 'Sentadilla Hack en Máquina',
    muscleGroup: 'cuadriceps',
    secondaryMuscles: ['gluteos'],
    movementPattern: 'sentadilla',
    equipment: 'maquina',
    instructions: [
      'Permite recorrido profundo y sobrecarga sin límite de estabilidad del core.',
    ],
    variants: ['barbell_back_squat', 'leg_press_45'],
  },
  {
    id: 'leg_press_45',
    name: 'Prensa de Piernas Inclinada 45°',
    muscleGroup: 'cuadriceps',
    secondaryMuscles: ['gluteos'],
    movementPattern: 'sentadilla',
    equipment: 'maquina',
    instructions: [
      'Pies a media altura de la plataforma; no despegar el sacro del respaldo en la profundidad.',
    ],
    variants: ['hack_squat_machine', 'barbell_back_squat'],
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Sentadilla Búlgara con Mancuernas',
    muscleGroup: 'cuadriceps',
    secondaryMuscles: ['gluteos', 'isquios'],
    movementPattern: 'zancada',
    equipment: 'mancuerna',
    instructions: [
      'Pie trasero elevado en banco; baja en vertical cargando el 85% del peso en la pierna delantera.',
    ],
    variants: ['leg_press_45'],
  },
  {
    id: 'leg_extension_machine',
    name: 'Extensiones de Cuádriceps en Máquina',
    muscleGroup: 'cuadriceps',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'maquina',
    instructions: [
      'Alinea el eje de la rodilla con el pivote de la máquina; pausa de 1s en extensión completa.',
    ],
    variants: ['barbell_back_squat'],
  },

  // ========================================================
  // 7. ISQUIOTIBIALES & CADENA POSTERIOR
  // ========================================================
  {
    id: 'romanian_deadlift_barbell',
    name: 'Peso Muerto Rumano con Barra (RDL)',
    muscleGroup: 'isquios',
    secondaryMuscles: ['gluteos', 'espalda'],
    movementPattern: 'bisagra_cadera',
    equipment: 'barra',
    instructions: [
      'Rodillas con ligera semiflexión fija; proyecta la cadera hacia atrás sintiendo tensión en isquios.',
      'Mantén la barra pegada a las espinillas sin redondear la columna lumbar.',
    ],
    variants: ['romanian_deadlift_dumbbells', 'seated_leg_curl_machine'],
  },
  {
    id: 'romanian_deadlift_dumbbells',
    name: 'Peso Muerto Rumano con Mancuernas',
    muscleGroup: 'isquios',
    secondaryMuscles: ['gluteos'],
    movementPattern: 'bisagra_cadera',
    equipment: 'mancuerna',
    instructions: [
      'Excelente libertad para orientar las muñecas y focalizar el estiramiento de isquiosurales.',
    ],
    variants: ['romanian_deadlift_barbell'],
  },
  {
    id: 'seated_leg_curl_machine',
    name: 'Curl Femoral Sentado en Máquina',
    muscleGroup: 'isquios',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'maquina',
    instructions: [
      'La flexión de cadera sentada optimiza el estiramiento previo de los isquiotibiales.',
    ],
    variants: ['lying_leg_curl_machine', 'romanian_deadlift_barbell'],
  },
  {
    id: 'lying_leg_curl_machine',
    name: 'Curl Femoral Tumbado en Máquina',
    muscleGroup: 'isquios',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'maquina',
    instructions: [
      'Mantén la pelvis pegada al banco para evitar hiperextensión lumbar al flexionar las rodillas.',
    ],
    variants: ['seated_leg_curl_machine'],
  },

  // ========================================================
  // 8. GLÚTEOS
  // ========================================================
  {
    id: 'barbell_hip_thrust',
    name: 'Hip Thrust con Barra en Banco',
    muscleGroup: 'gluteos',
    secondaryMuscles: ['isquios'],
    movementPattern: 'bisagra_cadera',
    equipment: 'barra',
    instructions: [
      'Espalda apoyada justo debajo de las escápulas; empuja con los talones y retroversión pélvica arriba.',
      'Pausa de 1 segundo en máxima contracción con la tibia perpendicular al suelo.',
    ],
    variants: ['glute_cable_kickback', 'romanian_deadlift_barbell'],
  },
  {
    id: 'glute_cable_kickback',
    name: 'Patada de Glúteo en Polea Baja',
    muscleGroup: 'gluteos',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Extiende la cadera manteniendo la pierna alineada con la trayectoria de la fibra glútea.',
    ],
    variants: ['barbell_hip_thrust'],
  },

  // ========================================================
  // 9. GEMELOS
  // ========================================================
  {
    id: 'standing_calf_raise_machine',
    name: 'Elevación de Talones de Pie en Máquina',
    muscleGroup: 'gemelos',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'maquina',
    instructions: [
      'Rodillas casi bloqueadas para reclutar el gastrocnemio; pausa abajo de 2s en máximo estiramiento.',
    ],
    variants: ['seated_calf_raise_machine'],
  },
  {
    id: 'seated_calf_raise_machine',
    name: 'Elevación de Talones Sentado en Máquina',
    muscleGroup: 'gemelos',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'maquina',
    instructions: [
      'Rodilla flexionada a 90°; aísla el sóleo eliminando la acción del gastrocnemio.',
    ],
    variants: ['standing_calf_raise_machine'],
  },

  // ========================================================
  // 10. CORE
  // ========================================================
  {
    id: 'ab_wheel_rollout',
    name: 'Rueda Abdominal (Ab Wheel Rollout)',
    muscleGroup: 'core',
    secondaryMuscles: ['espalda', 'pecho'],
    movementPattern: 'aislamiento',
    equipment: 'peso_corporal',
    instructions: [
      'Anti-extensión espinal pura; rueda hacia adelante contrayendo glúteos y transverso sin que caiga la pelvis.',
    ],
    variants: ['hanging_leg_raises', 'cable_kneeling_crunch'],
  },
  {
    id: 'hanging_leg_raises',
    name: 'Elevaciones de Piernas Colgado en Barra',
    muscleGroup: 'core',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'peso_corporal',
    instructions: [
      'Flexiona la pelvis hacia las costillas en lugar de solo levantar las piernas con los flexores de cadera.',
    ],
    variants: ['ab_wheel_rollout', 'cable_kneeling_crunch'],
  },
  {
    id: 'cable_kneeling_crunch',
    name: 'Crunch Abdominal en Polea Alta de Rodillas',
    muscleGroup: 'core',
    secondaryMuscles: [],
    movementPattern: 'aislamiento',
    equipment: 'polea',
    instructions: [
      'Enrolla la columna acercando el esternón a la pelvis con carga progresiva dosificada.',
    ],
    variants: ['hanging_leg_raises', 'ab_wheel_rollout'],
  },

  // ========================================================
  // 11. CUERPO COMPLETO / MULTIARTICULAR
  // ========================================================
  {
    id: 'conventional_deadlift_barbell',
    name: 'Peso Muerto Convencional con Barra',
    muscleGroup: 'cuerpo_completo',
    secondaryMuscles: ['espalda', 'isquios', 'gluteos', 'cuadriceps', 'core'],
    movementPattern: 'bisagra_cadera',
    equipment: 'barra',
    instructions: [
      'Barra sobre el mediopié, escápulas sobre la barra, caderas entre las rodillas y los hombros.',
      'Tensa la barra eliminando la holgura antes de empujar el suelo con las piernas.',
    ],
    variants: ['romanian_deadlift_barbell', 'barbell_back_squat'],
  },
  {
    id: 'kettlebell_swing_two_handed',
    name: 'Kettlebell Swing a Dos Manos (Hardstyle)',
    muscleGroup: 'cuerpo_completo',
    secondaryMuscles: ['gluteos', 'isquios', 'core'],
    movementPattern: 'bisagra_cadera',
    equipment: 'kettlebell',
    instructions: [
      'Potencia balística pura de cadera; bloquea rodillas y glúteos de forma sincrónica sin tirar con los hombros.',
    ],
    variants: ['conventional_deadlift_barbell'],
  },
];

/**
 * Búsqueda y utilidades del catálogo
 */
export const getExerciseById = (id: string): ExerciseItem | undefined => {
  return EXERCISE_CATALOG.find(ex => ex.id === id);
};

export const getExercisesByMuscleGroup = (group: MuscleGroup): ExerciseItem[] => {
  return EXERCISE_CATALOG.filter(ex => ex.muscleGroup === group);
};

export const searchExercises = (
  query: string,
  filterMuscle?: MuscleGroup | 'todos',
  filterPattern?: MovementPattern | 'todos'
): ExerciseItem[] => {
  const q = query.trim().toLowerCase();
  return EXERCISE_CATALOG.filter(ex => {
    const matchesQuery =
      !q ||
      ex.name.toLowerCase().includes(q) ||
      ex.muscleGroup.toLowerCase().includes(q) ||
      ex.equipment.toLowerCase().includes(q);

    const matchesMuscle = !filterMuscle || filterMuscle === 'todos' || ex.muscleGroup === filterMuscle;
    const matchesPattern = !filterPattern || filterPattern === 'todos' || ex.movementPattern === filterPattern;

    return matchesQuery && matchesMuscle && matchesPattern;
  });
};
