export type FoodCategory =
  | 'carnes_aves'
  | 'pescados_mariscos'
  | 'huevos'
  | 'lacteos'
  | 'cereales_granos'
  | 'tuberculos_raices'
  | 'legumbres'
  | 'frutas'
  | 'verduras_hortalizas'
  | 'grasas_aceites'
  | 'frutos_secos_semillas'
  | 'suplementos';

export type FoodPreparationState =
  | 'crudo'
  | 'cocido'
  | 'hervido'
  | 'asado_plancha'
  | 'horneado'
  | 'seco'
  | 'enlatado_en_agua';

export interface FoodPortion {
  name: string;
  grams: number;
}

export interface FoodDataSource {
  provider: 'USDA FoodData Central';
  fdcId: number;
  dataset: 'SR Legacy' | 'Foundation Foods' | 'Survey (FNDDS)';
  foodDescriptionEn: string;
  sourceUrl: string;
  version: string;
}

export interface FoodItem {
  id: string;
  name: string;
  category: FoodCategory;
  state: FoodPreparationState;
  servingUnit: 'g';
  referenceGrams: 100;
  // Nutrientes por 100 gramos de porción comestible:
  caloriesPer100g: number; // kcal
  proteinPer100g: number;  // g
  carbsPer100g: number;    // g
  fatsPer100g: number;     // g
  fiberPer100g: number;    // g
  // Metadatos de procedencia y porciones sugeridas:
  source: FoodDataSource;
  commonPortions: FoodPortion[];
  tags: string[];
}

export interface NutritionalBreakdown {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
}

export interface CalculatedFoodPortion {
  foodId: string;
  foodName: string;
  grams: number;
  nutrients: NutritionalBreakdown;
  sourceFdcId: number;
}

export type MealMomentType = 'desayuno' | 'almuerzo' | 'merienda' | 'cena' | 'snack';

export interface RecipeIngredient {
  foodId: string;
  foodName: string;
  grams: number;
  preparationState?: FoodPreparationState;
  nutrients: NutritionalBreakdown;
  sourceFdcId: number;
}

export interface Recipe {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  suggestedMoment: MealMomentType;
  servings: number;
  prepTimeMinutes?: number;
  ingredients: RecipeIngredient[];
  totalNutrients: NutritionalBreakdown;
  instructions?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedMealSlot {
  recipeId: string;
  recipeName: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  servings: number;
  imageUrl?: string;
  prepTimeMinutes?: number;
  logged?: boolean;
  loggedAt?: string;
  ingredients?: Array<{
    foodId: string;
    foodName: string;
    grams: number;
    state?: FoodPreparationState;
  }>;
}

export interface DayMealPlan {
  date: string; // 'YYYY-MM-DD'
  dayLabel: string; // 'Lun 21', 'Mar 22', etc.
  dayType?: string;
  meals: {
    desayuno?: PlannedMealSlot;
    almuerzo?: PlannedMealSlot;
    merienda?: PlannedMealSlot;
    cena?: PlannedMealSlot;
    snack?: PlannedMealSlot;
  };
}

export interface WeeklyMealPlan {
  id: string;
  userId: string;
  weekStart: string; // 'YYYY-MM-DD' (Lunes)
  weekEnd: string;   // 'YYYY-MM-DD' (Domingo)
  label: string;
  days: Record<string, DayMealPlan>;
  createdAt: string;
  updatedAt: string;
}
