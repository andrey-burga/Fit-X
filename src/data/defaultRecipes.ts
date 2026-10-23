import { Recipe } from '../types/nutrition';
import { calculateRecipeNutrients } from '../services/nutritionMath';
import { getFoodOrThrow } from '../services/nutritionMath';

/**
 * Generador de recetas base verificadas para el modo demostración.
 *
 * Cada ingrediente está estrictamente referenciado a un registro verificado
 * del Catálogo Nutricional USDA FoodData Central.
 * Los totales nutricionales son computados mediante el motor matemático puro.
 */
function createVerifiedRecipe(
  id: string,
  name: string,
  description: string,
  suggestedMoment: 'desayuno' | 'almuerzo' | 'merienda' | 'cena' | 'snack',
  servings: number,
  prepTimeMinutes: number,
  rawIngredients: Array<{ foodId: string; grams: number }>,
  instructions?: string,
  imageUrl?: string
): Recipe {
  const { total, ingredientsBreakdown } = calculateRecipeNutrients(rawIngredients, servings);

  const ingredients = ingredientsBreakdown.map(ib => {
    const food = getFoodOrThrow(ib.foodId);
    return {
      foodId: ib.foodId,
      foodName: ib.foodName,
      grams: ib.grams,
      preparationState: food.state,
      nutrients: ib.nutrients,
      sourceFdcId: ib.sourceFdcId,
    };
  });

  return {
    id,
    name,
    description,
    suggestedMoment,
    servings,
    prepTimeMinutes,
    ingredients,
    totalNutrients: total,
    instructions: instructions || 'Preparación estándar según macros planificados.',
    imageUrl,
    createdAt: '2024-10-21T07:00:00.000Z',
    updatedAt: '2024-10-21T07:00:00.000Z',
  };
}

export const DEFAULT_RECIPES: Recipe[] = [
  createVerifiedRecipe(
    'rec-desayuno-huevos-avena',
    'Huevos revueltos con espinacas y avena',
    'Desayuno proteico de rápida digestión con carbohidratos complejos y micronutrientes.',
    'desayuno',
    1,
    12,
    [
      { foodId: 'usda-173424-huevo-entero-cocido', grams: 180 },
      { foodId: 'usda-168462-espinaca-cruda', grams: 80 },
      { foodId: 'usda-169705-avena-hojuelas-cruda', grams: 60 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 5 },
    ],
    '1. Batir los huevos con una pizca de sal. 2. Saltear las espinacas en el aceite de oliva a fuego medio. 3. Añadir los huevos y cocinar al punto deseado. 4. Cocer la avena en agua o leche y servir junto a los huevos.',
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCaLCWsp80cw4_JZSa5Forb0gSv2U9PjeCAtRwrUyMh-N7RRfdBMgfQMByxsF5-qgyZtQRicY0VqJuLX6izyRDV8weRBoxH19JVhpLbYm3gdfiBXlqHJtvCyFspuW__xfIUpc6yXCTeNJMkihsdQaMUfmK-mg2d0_l32ksBNE_9Wj2Yv7fSkZjw9Mthublpa0pg2h172pUaUU2kiO0DbcmcjbJmJ_XF8AaZmtifxwY1'
  ),

  createVerifiedRecipe(
    'rec-almuerzo-pechuga-arroz-aguacate',
    'Pechuga a la plancha con arroz integral y aguacate',
    'Almuerzo principal post-entrenamiento: máxima concentración proteica magra y ácidos grasos monoinsaturados.',
    'almuerzo',
    1,
    25,
    [
      { foodId: 'usda-171477-pechuga-pollo-asada', grams: 200 },
      { foodId: 'usda-169704-arroz-integral-cocido', grams: 180 },
      { foodId: 'usda-171706-aguacate-hass-crudo', grams: 50 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 10 },
    ],
    '1. Sellar la pechuga a la plancha con condimentos al gusto. 2. Servir con el arroz integral tibio. 3. Cortar el aguacate Hass en láminas y aderezar con el aceite de oliva.',
    'https://lh3.googleusercontent.com/aida-public/AB6AXuByuH3TMku4giIP0zwEp21xVGr7M-Rznw3HLr5P0kgEdNTYDprj0LFldb5Ukhfo9jG_8bzvuJ6kTtUR-7cBVaBt6-MO-W2xqozUhTDlEnFH7GATq-vNQB9F69CrhWT-0dz5ZPLWECjw1NArmyRioVzPiAir0BfIyXzuw6GuIK1ez7rm1bVdKn6lMVNBP2OBiiX1S_SxWr3dGXcDJolflZeqrNVEUIPkrQdD8N3t_JWU'
  ),

  createVerifiedRecipe(
    'rec-merienda-yogur-griego-almendras',
    'Yogur griego con nueces y fruta fresca',
    'Refrigerio anabólico rico en caseína micelar, magnesio y energía limpia para la tarde.',
    'merienda',
    1,
    5,
    [
      { foodId: 'usda-170903-yogur-griego-natural-bajo-en-grasa', grams: 200 },
      { foodId: 'usda-170567-almendras-crudas', grams: 25 },
      { foodId: 'usda-173944-banano-maduro-crudo', grams: 80 },
    ],
    '1. Verter el yogur griego en un bol. 2. Cortar el banano en rodajas. 3. Añadir las almendras troceadas y espolvorear canela opcional.',
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCpwgDONsTCQ_sYsMej3NkxsEa0Q1gyyVCJ5_TsfrrSqjDvNj8l4XVT5VKCx9Oa6q5Skbjy1iGBydJcXFU_aAyeaGv1AuFk7C9PCAm0eRO5SuXU1Se_BQ2jQmDqOyjL0B56IfKz9gJfN9-0eaVt4eAEZLNXyGYQi5eC2ftLabKvjWGn3itrLC0O8ioluDqsxDnAAifXwIVrebzH2c5mMdRkn4ruUDWstcp8IL4g-pdV'
  ),

  createVerifiedRecipe(
    'rec-cena-salmon-papa-brocoli',
    'Salmón fresco con puré de papa y brócoli al vapor',
    'Cena de regeneración muscular con EPA/DHA, potasio y antioxidantes sulforafanos.',
    'cena',
    1,
    20,
    [
      { foodId: 'usda-175168-salmon-atlantico-horneado', grams: 180 },
      { foodId: 'usda-170520-papa-hervida-sin-piel', grams: 200 },
      { foodId: 'usda-170380-brocoli-cocido-al-vapor', grams: 120 },
      { foodId: 'usda-171413-aceite-oliva-virgen-extra', grams: 5 },
    ],
    '1. Cocinar el filete de salmón al horno o plancha (3-4 mins por lado). 2. Triturar la papa hervida con sal y pimienta. 3. Cocer los floretes de brócoli al vapor. 4. Emplatar con un toque de aceite de oliva.',
    'https://lh3.googleusercontent.com/aida-public/AB6AXuD1GedTqAYE2-E63aeRzzOGj13pnmq4h76X0jMrSu4jr6pJ2ynMZbiipVdazGcF79aaKVLkYTdT7arQFbQGxklK8VlvLQiQ1nZoFxXiVYb935NkPEBEqCwrxy5EqnuTV_mxIcqrae6Yv8bZpy3SCkxvWguVE3RBzkgaTXu1-e7S_9ktQUnv576ogDGoee-sfX0jVvsj5AcBJ-gCxL1twoM3s7ddRH4EgZvKzd-mcuB6'
  ),
];
