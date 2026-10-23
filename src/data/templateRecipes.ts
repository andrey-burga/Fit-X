import { Recipe, RecipeIngredient, WeeklyMealPlan, DayMealPlan } from '../types/nutrition';
import { calculateRecipeNutrients, roundNutrients, getFoodById } from '../services/nutritionMath';
import { getWeekDays } from '../services/dateUtils';

interface RecipeRawDefinition {
  id: string;
  name: string;
  description: string;
  suggestedMoment: 'desayuno' | 'almuerzo' | 'merienda' | 'cena' | 'snack';
  servings: number;
  prepTimeMinutes: number;
  instructions: string;
  imageUrl?: string;
  ingredients: Array<{ foodId: string; grams: number }>;
}

const RAW_TEMPLATE_RECIPES: RecipeRawDefinition[] = [
  {
    id: 'rec_huevos_avena',
    name: 'Huevos revueltos con espinacas y avena',
    description: 'Desayuno balanceado con alta biodisponibilidad proteica y carbohidratos complejos de absorción sostenida.',
    suggestedMoment: 'desayuno',
    servings: 1,
    prepTimeMinutes: 12,
    instructions: '1. Batir los huevos enteros en un tazón.\n2. Saltear las espinacas frescas con el aceite de oliva a fuego medio durante 2 minutos.\n3. Agregar los huevos y remover suavemente hasta obtener textura cremosa.\n4. Servir acompañado de las hojuelas de avena hidratadas o cocidas al gusto.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCaLCWsp80cw4_JZSa5Forb0gSv2U9PjeCAtRwrUyMh-N7RRfdBMgfQMByxsF5-qgyZtQRicY0VqJuLX6izyRDV8weRBoxH19JVhpLbYm3gdfiBXlqHJtvCyFspuW__xfIUpc6yXCTeNJMkihsdQaMUfmK-mg2d0_l32ksBNE_9Wj2Yv7fSkZjw9Mthublpa0pg2h172pUaUU2kiO0DbcmcjbJmJ_XF8AaZmtifxwY1',
    ingredients: [
      { foodId: 'usda-173424-huevo-entero-cocido', grams: 180 },
      { foodId: 'usda-168462-espinaca-cruda', grams: 80 },
      { foodId: 'usda-169705-avena-hojuelas-cruda', grams: 60 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 5 },
    ],
  },
  {
    id: 'rec_pollo_arroz',
    name: 'Pechuga a la plancha con arroz integral y aguacate',
    description: 'Comida anabólica principal de post-entreno con aminoácidos ramificados y lípidos monoinsaturados.',
    suggestedMoment: 'almuerzo',
    servings: 1,
    prepTimeMinutes: 25,
    instructions: '1. Sazonar la pechuga de pollo con especias naturales al gusto.\n2. Cocinar a la plancha caliente con una capa fina de aceite de oliva hasta dorar por ambos lados (aprox. 6-7 min por cara).\n3. Calentar el arroz integral cocido.\n4. Cortar el aguacate Hass fresco en láminas y emplatar junto a la pechuga.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuByuH3TMku4giIP0zwEp21xVGr7M-Rznw3HLr5P0kgEdNTYDprj0LFldb5Ukhfo9jG_8bzvuJ6kTtUR-7cBVaBt6-MO-W2xqozUhTDlEnFH7GATq-vNQB9F69CrhWT-0dz5ZPLWECjw1NArmyRioVzPiAir0BfIyXzuw6GuIK1ez7rm1bVdKn6lMVNBP2OBiiX1S_SxWr3dGXcDJolflZeqrNVEUIPkrQdD8N3t_JWU',
    ingredients: [
      { foodId: 'usda-171477-pechuga-pollo-asada', grams: 200 },
      { foodId: 'usda-169704-arroz-integral-cocido', grams: 180 },
      { foodId: 'usda-171706-aguacate-hass-crudo', grams: 50 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 10 },
    ],
  },
  {
    id: 'rec_yogur_almendras',
    name: 'Yogur griego con almendras y banano maduro',
    description: 'Merienda de alta saciedad rica en caseína y micronutrientes esenciales como magnesio y potasio.',
    suggestedMoment: 'merienda',
    servings: 1,
    prepTimeMinutes: 5,
    instructions: '1. Verter el yogur griego natural bajo en grasa en un tazón.\n2. Rebanar el banano maduro en rodajas uniformes y colocar sobre el yogur.\n3. Añadir las almendras crudas enteras o troceadas para un toque crujiente.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCpwgDONsTCQ_sYsMej3NkxsEa0Q1gyyVCJ5_TsfrrSqjDvNj8l4XVT5VKCx9Oa6q5Skbjy1iGBydJcXFU_aAyeaGv1AuFk7C9PCAm0eRO5SuXU1Se_BQ2jQmDqOyjL0B56IfKz9gJfN9-0eaVt4eAEZLNXyGYQi5eC2ftLabKvjWGn3itrLC0O8ioluDqsxDnAAifXwIVrebzH2c5mMdRkn4ruUDWstcp8IL4g-pdV',
    ingredients: [
      { foodId: 'usda-170903-yogur-griego-natural-bajo-en-grasa', grams: 200 },
      { foodId: 'usda-170567-almendras-crudas', grams: 25 },
      { foodId: 'usda-173944-banano-maduro-crudo', grams: 80 },
    ],
  },
  {
    id: 'rec_salmon_papa',
    name: 'Salmón al horno con papa cocida y brócoli',
    description: 'Cena regenerativa rica en ácidos grasos Omega-3 (EPA/DHA) y antioxidantes sulforafano para descanso profundo.',
    suggestedMoment: 'cena',
    servings: 1,
    prepTimeMinutes: 20,
    instructions: '1. Precalentar el horno a 200 °C.\n2. Disponer el filete de salmón en bandeja con sal marina y rociar con el aceite de oliva.\n3. Hornear durante 12-14 minutos.\n4. Servir con papa hervida al punto y ramilletes de brócoli cocidos al vapor.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD1GedTqAYE2-E63aeRzzOGj13pnmq4h76X0jMrSu4jr6pJ2ynMZbiipVdazGcF79aaKVLkYTdT7arQFbQGxklK8VlvLQiQ1nZoFxXiVYb935NkPEBEqCwrxy5EqnuTV_mxIcqrae6Yv8bZpy3SCkxvWguVE3RBzkgaTXu1-e7S_9ktQUnv576ogDGoee-sfX0jVvsj5AcBJ-gCxL1twoM3s7ddRH4EgZvKzd-mcuB6',
    ingredients: [
      { foodId: 'usda-175168-salmon-atlantico-horneado', grams: 180 },
      { foodId: 'usda-170520-papa-hervida-sin-piel', grams: 200 },
      { foodId: 'usda-170380-brocoli-cocido-al-vapor', grams: 120 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 5 },
    ],
  },
  {
    id: 'rec_batido_whey',
    name: 'Batido hiperproteico de Whey con avena y manzana',
    description: 'Snack líquido de asimilación rápida con proteína de suero aislada y fibra prebiótica.',
    suggestedMoment: 'snack',
    servings: 1,
    prepTimeMinutes: 4,
    instructions: '1. Agregar en la licuadora la leche descremada, el polvo de proteína whey y la avena.\n2. Picar la manzana fresca y añadir.\n3. Licuar a máxima potencia durante 45 segundos hasta homogeneizar.',
    ingredients: [
      { foodId: 'usda-173177-proteina-suero-whey-polvo', grams: 35 },
      { foodId: 'usda-171269-leche-descremada-fluida', grams: 250 },
      { foodId: 'usda-169705-avena-hojuelas-cruda', grams: 40 },
      { foodId: 'usda-171688-manzana-con-piel-cruda', grams: 100 },
    ],
  },
  {
    id: 'rec_lomo_arroz',
    name: 'Lomo de res asado con arroz blanco y tomate',
    description: 'Almuerzo de alta densidad con creatina natural, hierro hemo y carbohidratos de reposición glucogénica.',
    suggestedMoment: 'almuerzo',
    servings: 1,
    prepTimeMinutes: 22,
    instructions: '1. Asar el filete de lomo de res magro a fuego alto 3-4 minutos por lado para sellar jugos.\n2. Acompañar con arroz blanco caliente y rodajas de tomate sazonadas con aceite de oliva.',
    ingredients: [
      { foodId: 'usda-171811-lomo-res-magro-asado', grams: 180 },
      { foodId: 'usda-168878-arroz-blanco-cocido', grams: 180 },
      { foodId: 'usda-170457-tomate-rojo-maduro-crudo', grams: 100 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 8 },
    ],
  },
  {
    id: 'rec_tilapia_espinaca',
    name: 'Filete de tilapia al horno con papa y espinaca',
    description: 'Cena ligera hiperproteica baja en grasa para optimizar la síntesis de hormona de crecimiento durante el sueño.',
    suggestedMoment: 'cena',
    servings: 1,
    prepTimeMinutes: 18,
    instructions: '1. Sazonar el filete de tilapia con ajo y hierbas finas.\n2. Cocinar al horno a 190 °C durante 15 minutos.\n3. Saltear brevemente las espinacas con aceite de oliva y servir junto a las papas hervidas.',
    ingredients: [
      { foodId: 'usda-175177-tilapia-filete-cocido', grams: 200 },
      { foodId: 'usda-170520-papa-hervida-sin-piel', grams: 180 },
      { foodId: 'usda-168462-espinaca-cruda', grams: 100 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 5 },
    ],
  },
  {
    id: 'rec_atun_frijoles',
    name: 'Bowl de atún con frijoles negros y aguacate',
    description: 'Combinación balanceada de proteína marina, fibra soluble y ácidos grasos esenciales para digestión óptima.',
    suggestedMoment: 'almuerzo',
    servings: 1,
    prepTimeMinutes: 8,
    instructions: '1. Escurrir bien el atún en agua.\n2. Mezclar en un tazón con los frijoles negros cocidos.\n3. Incorporar cubos de aguacate fresco y tomate picado. Mezclar suavemente.',
    ingredients: [
      { foodId: 'usda-171986-atun-en-agua-escurrido', grams: 160 },
      { foodId: 'usda-173735-frijoles-negros-cocidos', grams: 150 },
      { foodId: 'usda-171706-aguacate-hass-crudo', grams: 40 },
      { foodId: 'usda-170457-tomate-rojo-maduro-crudo', grams: 80 },
    ],
  },
  {
    id: 'rec_claras_aguacate',
    name: 'Tortilla de claras de huevo con tomate y aguacate',
    description: 'Desayuno ultra magro enfocado en definición muscular y pureza proteica.',
    suggestedMoment: 'desayuno',
    servings: 1,
    prepTimeMinutes: 10,
    instructions: '1. Verter las claras en sartén antiadherente caliente rociada con aceite de oliva.\n2. Cocinar a fuego bajo hasta que cuajen.\n3. Rellenar con rodajas de tomate y láminas de aguacate antes de plegar.',
    ingredients: [
      { foodId: 'usda-2707169-clara-de-huevo-cocida', grams: 200 },
      { foodId: 'usda-170457-tomate-rojo-maduro-crudo', grams: 80 },
      { foodId: 'usda-171706-aguacate-hass-crudo', grams: 40 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 5 },
    ],
  },
];

/**
 * Convierte las definiciones crudas en objetos Recipe completamente calculados
 * mediante el motor matemático oficial y alimentos del catálogo USDA.
 */
export function buildTemplateRecipes(ownerUserId?: string): Recipe[] {
  const nowIso = '2024-10-24T08:00:00.000Z';

  return RAW_TEMPLATE_RECIPES.map(def => {
    const { total, perServing, ingredientsBreakdown } = calculateRecipeNutrients(
      def.ingredients,
      def.servings
    );

    const detailedIngredients: RecipeIngredient[] = def.ingredients.map((ing, idx) => {
      const food = getFoodById(ing.foodId);
      const breakdown = ingredientsBreakdown[idx]?.nutrients || {
        calories: 0,
        protein: 0,
        carbs: 0,
        fats: 0,
        fiber: 0,
      };

      return {
        foodId: ing.foodId,
        foodName: food?.name || 'Alimento del catálogo',
        grams: ing.grams,
        preparationState: food?.state || 'cocido',
        nutrients: roundNutrients(breakdown, 1),
        sourceFdcId: food?.source.fdcId || 0,
      };
    });

    return {
      id: def.id,
      userId: ownerUserId,
      name: def.name,
      description: def.description,
      suggestedMoment: def.suggestedMoment,
      servings: def.servings,
      prepTimeMinutes: def.prepTimeMinutes,
      ingredients: detailedIngredients,
      totalNutrients: roundNutrients(total, 1),
      instructions: def.instructions,
      imageUrl: def.imageUrl,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}

export const TEMPLATE_RECIPES: Recipe[] = buildTemplateRecipes();

/**
 * Genera un plan semanal base dinámico asignando recetas a los días de la semana especificada.
 */
export function createDefaultWeeklyPlan(
  weekStart: string,
  weekEnd: string,
  userId: string,
  recipes: Recipe[] = TEMPLATE_RECIPES
): WeeklyMealPlan {
  const daysList = getWeekDays(weekStart);
  const recipesMap = new Map(recipes.map(r => [r.id, r]));

  // Recetas predeterminadas por momento
  const breakfast1 = recipesMap.get('rec_huevos_avena') || recipes[0];
  const breakfast2 = recipesMap.get('rec_claras_aguacate') || recipes[0];
  const lunch1 = recipesMap.get('rec_pollo_arroz') || recipes[1];
  const lunch2 = recipesMap.get('rec_lomo_arroz') || recipes[1];
  const snack1 = recipesMap.get('rec_yogur_almendras') || recipes[2];
  const snack2 = recipesMap.get('rec_batido_whey') || recipes[2];
  const dinner1 = recipesMap.get('rec_salmon_papa') || recipes[3];
  const dinner2 = recipesMap.get('rec_tilapia_espinaca') || recipes[3];

  const planDays: Record<string, DayMealPlan> = {};

  const trainingDayTypes = [
    'Día de Entrenamiento Pierna',
    'Día de Entrenamiento Empuje',
    'Día de Descanso Activo + Movilidad',
    'Día de Entrenamiento Torso / Pesado',
    'Día de Entrenamiento Tracción + Brazos',
    'Día de Cardio Zona 2 / HIIT',
    'Día de Recuperación Sistémica',
  ];

  daysList.forEach((dayItem, index) => {
    const isEven = index % 2 === 0;
    const b = isEven ? breakfast1 : breakfast2;
    const l = isEven ? lunch1 : lunch2;
    const s = isEven ? snack1 : snack2;
    const d = isEven ? dinner1 : dinner2;

    planDays[dayItem.dateStr] = {
      date: dayItem.dateStr,
      dayLabel: dayItem.dayLabel,
      dayType: trainingDayTypes[index] || 'Día Regular',
      meals: {
        desayuno: b
          ? {
              recipeId: b.id,
              recipeName: b.name,
              calories: b.totalNutrients.calories,
              protein: b.totalNutrients.protein,
              carbs: b.totalNutrients.carbs,
              fats: b.totalNutrients.fats,
              servings: 1,
              imageUrl: b.imageUrl,
              prepTimeMinutes: b.prepTimeMinutes,
              ingredients: b.ingredients.map(ing => ({
                foodId: ing.foodId,
                foodName: ing.foodName,
                grams: ing.grams,
                state: ing.preparationState,
              })),
            }
          : undefined,
        almuerzo: l
          ? {
              recipeId: l.id,
              recipeName: l.name,
              calories: l.totalNutrients.calories,
              protein: l.totalNutrients.protein,
              carbs: l.totalNutrients.carbs,
              fats: l.totalNutrients.fats,
              servings: 1,
              imageUrl: l.imageUrl,
              prepTimeMinutes: l.prepTimeMinutes,
              ingredients: l.ingredients.map(ing => ({
                foodId: ing.foodId,
                foodName: ing.foodName,
                grams: ing.grams,
                state: ing.preparationState,
              })),
            }
          : undefined,
        merienda: s
          ? {
              recipeId: s.id,
              recipeName: s.name,
              calories: s.totalNutrients.calories,
              protein: s.totalNutrients.protein,
              carbs: s.totalNutrients.carbs,
              fats: s.totalNutrients.fats,
              servings: 1,
              imageUrl: s.imageUrl,
              prepTimeMinutes: s.prepTimeMinutes,
              ingredients: s.ingredients.map(ing => ({
                foodId: ing.foodId,
                foodName: ing.foodName,
                grams: ing.grams,
                state: ing.preparationState,
              })),
            }
          : undefined,
        cena: d
          ? {
              recipeId: d.id,
              recipeName: d.name,
              calories: d.totalNutrients.calories,
              protein: d.totalNutrients.protein,
              carbs: d.totalNutrients.carbs,
              fats: d.totalNutrients.fats,
              servings: 1,
              imageUrl: d.imageUrl,
              prepTimeMinutes: d.prepTimeMinutes,
              ingredients: d.ingredients.map(ing => ({
                foodId: ing.foodId,
                foodName: ing.foodName,
                grams: ing.grams,
                state: ing.preparationState,
              })),
            }
          : undefined,
      },
    };
  });

  return {
    id: `plan_${weekStart.replace(/-/g, '_')}`,
    userId,
    weekStart,
    weekEnd,
    label: `Plan Semanal (${weekStart} al ${weekEnd})`,
    days: planDays,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
