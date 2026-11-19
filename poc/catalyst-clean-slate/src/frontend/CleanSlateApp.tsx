/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Decoupled Clean-Slate Application Root
 */

import React from 'react';
import { AppShell } from './components/AppShell';
import { WorkspaceProvider, useWorkspace, type WorkspaceProviderProps } from './state/WorkspaceContext';
import { AdminConsoleView } from './views/AdminConsoleView';
import { CardioHiitView } from './views/CardioHiitView';
import { DashboardView } from './views/DashboardView';
import { LiveWorkoutView } from './views/LiveWorkoutView';
import { MealPlanPeriodizationView } from './views/MealPlanPeriodizationView';
import { NotificationsCenterView } from './views/NotificationsCenterView';
import { NutritionLogView } from './views/NutritionLogView';
import { PreAuthContractsView } from './views/PreAuthContractsView';
import { ProfileBiometricsView } from './views/ProfileBiometricsView';
import { RecipesSubstitutionsView } from './views/RecipesSubstitutionsView';
import { RoutinesAndMesocycleView } from './views/RoutinesAndMesocycleView';
import { ShoppingListView } from './views/ShoppingListView';
import { TrainingProgressView } from './views/TrainingProgressView';

const ActiveViewRouter: React.FC = () => {
  const { activeView } = useWorkspace();

  switch (activeView) {
    case 'dashboard':
      return <DashboardView />;
    case 'profile-biometrics':
      return <ProfileBiometricsView />;
    case 'nutrition-log':
      return <NutritionLogView />;
    case 'meal-plan':
      return <MealPlanPeriodizationView />;
    case 'recipes-substitutions':
      return <RecipesSubstitutionsView />;
    case 'shopping-list':
      return <ShoppingListView />;
    case 'routines-mesocycle':
      return <RoutinesAndMesocycleView />;
    case 'live-workout':
      return <LiveWorkoutView />;
    case 'training-progress':
      return <TrainingProgressView />;
    case 'cardio-hiit':
      return <CardioHiitView />;
    case 'notifications':
      return <NotificationsCenterView />;
    case 'admin-console':
      return <AdminConsoleView />;
    case 'preauth-contracts':
      return <PreAuthContractsView />;
    default:
      return <DashboardView />;
  }
};

export const CleanSlateApp: React.FC<Omit<WorkspaceProviderProps, 'children'>> = props => (
  <WorkspaceProvider {...props}>
    <AppShell>
      <ActiveViewRouter />
    </AppShell>
  </WorkspaceProvider>
);
