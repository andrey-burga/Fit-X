/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4.1 — Decoupled Clean-Slate Application Root with URL Auth Routing
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/AppShell';
import {
  navigateBrowserPath,
  parseAppRoute,
  ROUTE_CHANGE_EVENT,
  type ParsedAppRoute,
} from './routing/authRouting';
import { WorkspaceProvider, useWorkspace, type WorkspaceProviderProps } from './state/WorkspaceContext';
import { AdminConsoleView } from './views/AdminConsoleView';
import { AuthRoutesView } from './views/AuthRoutesView';
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

function parseRouteFromStringOrWindow(routeString?: string): ParsedAppRoute {
  if (typeof routeString === 'string') {
    const qIdx = routeString.indexOf('?');
    const pathname = qIdx >= 0 ? routeString.slice(0, qIdx) : routeString;
    const search = qIdx >= 0 ? routeString.slice(qIdx) : '';
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    return parseAppRoute({ pathname, search, origin });
  }
  return parseAppRoute();
}

export interface CleanSlateAppProps extends Omit<WorkspaceProviderProps, 'children' | 'currentRoute'> {
  initialRoutePath?: string;
}

export const CleanSlateApp: React.FC<CleanSlateAppProps> = ({
  initialRoutePath,
  onNavigateRoute,
  ...providerProps
}) => {
  const [route, setRoute] = useState<ParsedAppRoute>(() =>
    parseRouteFromStringOrWindow(initialRoutePath)
  );

  useEffect(() => {
    if (typeof initialRoutePath === 'string') {
      setRoute(parseRouteFromStringOrWindow(initialRoutePath));
      return;
    }
    if (typeof window === 'undefined') return;
    const syncRoute = () => setRoute(parseAppRoute(window.location));
    window.addEventListener('popstate', syncRoute);
    window.addEventListener(ROUTE_CHANGE_EVENT, syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener(ROUTE_CHANGE_EVENT, syncRoute);
    };
  }, [initialRoutePath]);

  const handleNavigateRoute = useCallback(
    (targetPath: string, options?: { replace?: boolean }) => {
      if (onNavigateRoute) {
        onNavigateRoute(targetPath, options);
      }
      if (typeof initialRoutePath === 'string') {
        setRoute(parseRouteFromStringOrWindow(targetPath));
      } else {
        navigateBrowserPath(targetPath, options);
      }
    },
    [initialRoutePath, onNavigateRoute]
  );

  const isAuthRoute = useMemo(
    () => route.routeId === 'auth-login' || route.routeId === 'auth-callback',
    [route.routeId]
  );

  return (
    <WorkspaceProvider
      {...providerProps}
      currentRoute={route.routeId}
      onNavigateRoute={handleNavigateRoute}
    >
      {isAuthRoute ? (
        <AuthRoutesView route={route} />
      ) : (
        <AppShell>
          <ActiveViewRouter />
        </AppShell>
      )}
    </WorkspaceProvider>
  );
};
