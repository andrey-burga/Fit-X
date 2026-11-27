/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.7 Unified Route Definitions, Endpoint Catalog & Dispatcher
 *
 * Single Source of Truth Architecture:
 * - `ROUTE_CONTRACT_SPECS` (`./routeContracts.ts`) holds the isomorphic metadata for all canonical routes.
 * - `ROUTE_DEFINITIONS` binds every one of those canonical specs to its executable backend
 *   handler, compiled path matcher, parameter sanitization, bound CSRF, RBAC, and anti-IDOR rules.
 * - `CLEAN_SLATE_ENDPOINT_CATALOG` is derived directly from `ROUTE_DEFINITIONS` (never duplicated).
 * - Legacy flat admin paths (`/api/v1/admin/invitations/revoke`, `/users/set-status`,
 *   `/users/set-role`, `/users/password-reset`) are removed and return `404 ROUTE_NOT_FOUND`.
 */

import crypto from 'node:crypto';
import type { IncomingHttpRequest, CleanSlateAuthGuard } from '../auth/cleanSlateAuthGuard.js';
import { AuthGuardError } from '../auth/cleanSlateAuthGuard.js';
import {
  assertStrictCookieAttributes,
  HttpSecurityError,
  HttpSecurityPolicy,
} from '../security/httpSecurityPolicy.js';
import {
  DomainValidationError,
  validateSafeIdentifier,
} from '../validators/domainValidators.js';
import { AdminGovernanceError, type AdminGovernanceService } from '../services/adminGovernanceService.js';
import type { AthleteDataService } from '../services/athleteDataService.js';
import type { AdminInvitationItem, AuthoritativeActor, UserRole } from '../types/cleanSlate.js';
import {
  CANONICAL_ROUTE_COUNT,
  OPTIONS_PREFLIGHT_CONTRACT,
  ROUTE_CONTRACT_SPECS,
  type ContractAuthLevel,
  type ContractHttpMethod,
  type RouteContractSpec,
} from './routeContracts.js';

export { CANONICAL_ROUTE_COUNT, OPTIONS_PREFLIGHT_CONTRACT, ROUTE_CONTRACT_SPECS };
export type { RouteContractSpec };

export interface EndpointResponse {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ApiEndpointDefinition {
  method: ContractHttpMethod;
  path: string;
  auth: ContractAuthLevel;
  replacesFirebaseMechanism: string;
  limitsAndNotes: string;
}

export type RouteParams = Record<string, string>;

export interface RouteHandlerContext {
  req: IncomingHttpRequest;
  params: RouteParams;
  corsHeaders: Record<string, string>;
  httpPolicy: HttpSecurityPolicy;
  authGuard: CleanSlateAuthGuard;
  athleteService: AthleteDataService;
  adminService: AdminGovernanceService;
  spec: RouteContractSpec;
}

export interface RouteDefinition extends RouteContractSpec {
  handler: (ctx: RouteHandlerContext) => Promise<EndpointResponse>;
}

function specById(id: string): RouteContractSpec {
  const found = ROUTE_CONTRACT_SPECS.find(spec => spec.id === id);
  if (!found) {
    throw new Error(`MISSING_ROUTE_CONTRACT_SPEC: Unknown route spec '${id}'.`);
  }
  return found;
}

function asPlainObject(raw: unknown, code = 'INVALID_REQUEST_BODY'): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DomainValidationError(code, 'Request body must be a JSON object.', 400);
  }
  return raw as Record<string, unknown>;
}

function queryStringParam(query: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!query || query[key] === undefined || query[key] === null) return undefined;
  const raw = Array.isArray(query[key]) ? query[key][0] : query[key];
  if (typeof raw !== 'string') {
    throw new DomainValidationError('INVALID_QUERY_PARAMETER', `Query parameter '${key}' must be a string.`, 400);
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function queryIntParam(
  query: Record<string, unknown> | undefined,
  key: string,
  min: number,
  max: number
): number | undefined {
  if (!query || query[key] === undefined || query[key] === null || query[key] === '') return undefined;
  const raw = Array.isArray(query[key]) ? query[key][0] : query[key];
  const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new DomainValidationError(
      'INVALID_QUERY_PARAMETER',
      `Query parameter '${key}' must be an integer in [${min}, ${max}].`,
      400
    );
  }
  return parsed;
}

function queryBooleanParam(query: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!query || query[key] === undefined || query[key] === null || query[key] === '') return undefined;
  const raw = Array.isArray(query[key]) ? query[key][0] : query[key];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const norm = raw.trim().toLowerCase();
    if (norm === 'true' || norm === '1') return true;
    if (norm === 'false' || norm === '0') return false;
  }
  throw new DomainValidationError(
    'INVALID_QUERY_PARAMETER',
    `Query parameter '${key}' must be a boolean ('true' or 'false').`,
    400
  );
}

function generateEntityId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function readCsrfHeader(req: IncomingHttpRequest): string | undefined {
  if (!req.headers) return undefined;
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.toLowerCase() === 'x-vigor-csrf' && typeof v === 'string' && v.trim() !== '') {
      return v.trim();
    }
  }
  return undefined;
}

function verifyBoundCsrfIfEnforced(
  ctx: Pick<RouteHandlerContext, 'req' | 'httpPolicy' | 'authGuard' | 'spec'>,
  actor: AuthoritativeActor
): void {
  if (!ctx.httpPolicy.isSignedCsrfEnforced()) return;
  if (ctx.spec.csrfPolicy !== 'signed_session_bound') return;

  const csrfToken = readCsrfHeader(ctx.req);
  if (!csrfToken) {
    throw new AuthGuardError(
      403,
      'CSRF_TOKEN_MISSING',
      `State-changing ${ctx.spec.method} request requires a server-issued X-Vigor-CSRF token.`
    );
  }
  if (!actor.sessionId) {
    throw new AuthGuardError(
      403,
      'CSRF_TOKEN_SESSION_MISMATCH',
      'Active signed session required to verify bound CSRF token.'
    );
  }
  ctx.authGuard.sessionTokens.verifyCsrfToken(csrfToken, {
    userId: actor.catalystUserId,
    sessionId: actor.sessionId,
    sessionEpoch: actor.sessionEpoch,
  });
}

async function authenticateForSpec(ctx: RouteHandlerContext): Promise<AuthoritativeActor> {
  const actor = await ctx.authGuard.authenticate(ctx.req, {
    allowTargetUidForAdmin: ctx.spec.allowTargetUidForAdmin,
    allowRoleFilterInQuery: ctx.spec.id === 'admin.users.list',
    allowAccountStatusFilterInQuery: ctx.spec.id === 'admin.users.list',
    requireSignedSession: ctx.spec.authPolicy === 'hmac_session',
    authPolicy: ctx.spec.authPolicy,
    requiresCatalystLiveCheck: ctx.spec.requiresCatalystLiveCheck,
  });
  verifyBoundCsrfIfEnforced(ctx, actor);
  if (!ctx.spec.allowedRoles.includes(actor.role)) {
    throw new AdminGovernanceError(
      'PERMISSION_DENIED',
      `Role '${actor.role}' is not authorized for ${ctx.spec.method} ${ctx.spec.path}.`,
      403
    );
  }
  return actor;
}

const VALID_ROLES: ReadonlySet<string> = new Set(['athlete', 'admin', 'superadmin']);
const VALID_ACCOUNT_STATUSES: ReadonlySet<string> = new Set(['active', 'suspended']);
const VALID_WORKOUT_STATUSES: ReadonlySet<string> = new Set(['in_progress', 'completed', 'abandoned']);
const VALID_GROCERY_FILTER_STATUSES: ReadonlySet<string> = new Set(['pending', 'bought', 'in_pantry', 'completed']);
const VALID_INVITE_STATUSES: ReadonlySet<string> = new Set(['pending', 'redeeming', 'redeemed', 'revoked', 'expired']);
const VALID_DIRECTORY_SORT_FIELDS: ReadonlySet<string> = new Set(['createdAt', 'displayName', 'email']);
const VALID_SORT_ORDERS: ReadonlySet<string> = new Set(['asc', 'desc']);
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;
const YYYY_MM_DD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_RE = /^\d{4}-\d{2}$/;

export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    ...specById('auth.session.bootstrapProfile'),
    handler: async ({ req, corsHeaders, authGuard }) => {
      const result = await authGuard.bootstrapAuthenticatedProfile(req);
      assertStrictCookieAttributes(result.setCookieHeader, {
        crossSiteCookies: authGuard.sessionTokens.isCrossSiteCookiesEnabled(),
      });
      const {
        signedSessionCookie: _omitTok,
        setCookieHeader,
        csrfToken,
        sid,
        expiresAt,
        expiresAtEpochSec,
        absoluteExpiresAtEpochSec,
        ...safeActor
      } = result;
      return {
        status: 200,
        headers: {
          ...corsHeaders,
          'Set-Cookie': setCookieHeader,
          'X-Vigor-CSRF-Token': csrfToken,
        },
        body: {
          success: true,
          actor: safeActor,
          sid,
          expiresAt,
          expiresAtEpochSec,
          absoluteExpiresAtEpochSec,
          csrfToken,
        },
      };
    },
  },
  {
    ...specById('auth.session.exchange'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const issued = await ctx.authGuard.issueSignedSession(actor);
      assertStrictCookieAttributes(issued.setCookieHeader, {
        crossSiteCookies: ctx.authGuard.sessionTokens.isCrossSiteCookiesEnabled(),
      });
      return {
        status: 200,
        headers: {
          ...ctx.corsHeaders,
          'Set-Cookie': issued.setCookieHeader,
          'X-Vigor-CSRF-Token': issued.csrfToken,
        },
        body: {
          success: true,
          actor: {
            ...actor,
            sessionId: issued.sid,
            sessionExpiresAtEpochSec: issued.expiresAtEpochSec,
          },
          sid: issued.sid,
          expiresAt: issued.expiresAt,
          expiresAtEpochSec: issued.expiresAtEpochSec,
          absoluteExpiresAtEpochSec: issued.absoluteExpiresAtEpochSec,
          csrfToken: issued.csrfToken,
        },
      };
    },
  },
  {
    ...specById('auth.session.refresh'),
    handler: async ctx => {
      if (ctx.httpPolicy.isSignedCsrfEnforced()) {
        // Verify active session + bound CSRF BEFORE revoking old sid or hitting Catalyst getUserDetails
        const preActor = await ctx.authGuard.authenticate(ctx.req, {
          requireSignedSession: true,
          authPolicy: 'hmac_session',
          requiresCatalystLiveCheck: false,
          isRefreshRequest: true,
        });
        verifyBoundCsrfIfEnforced(ctx, preActor);
      }
      const rotated = await ctx.authGuard.refreshSignedSession(ctx.req);
      assertStrictCookieAttributes(rotated.setCookieHeader, {
        crossSiteCookies: ctx.authGuard.sessionTokens.isCrossSiteCookiesEnabled(),
      });
      return {
        status: 200,
        headers: {
          ...ctx.corsHeaders,
          'Set-Cookie': rotated.setCookieHeader,
          'X-Vigor-CSRF-Token': rotated.csrfToken,
        },
        body: {
          success: true,
          actor: rotated.actor,
          sid: rotated.sid,
          expiresAt: rotated.expiresAt,
          expiresAtEpochSec: rotated.expiresAtEpochSec,
          absoluteExpiresAtEpochSec: rotated.absoluteExpiresAtEpochSec,
          csrfToken: rotated.csrfToken,
        },
      };
    },
  },
  {
    ...specById('auth.session.logout'),
    handler: async ctx => {
      if (ctx.httpPolicy.isSignedCsrfEnforced()) {
        const preActor = await ctx.authGuard.authenticate(ctx.req, {
          requireSignedSession: true,
          authPolicy: 'hmac_session',
          requiresCatalystLiveCheck: false,
          skipCatalystLiveRevalidation: true,
        });
        verifyBoundCsrfIfEnforced(ctx, preActor);
      }
      const loggedOut = await ctx.authGuard.logoutSession(ctx.req);
      assertStrictCookieAttributes(loggedOut.clearCookieHeader, {
        crossSiteCookies: ctx.authGuard.sessionTokens.isCrossSiteCookiesEnabled(),
      });
      return {
        status: 200,
        headers: { ...ctx.corsHeaders, 'Set-Cookie': loggedOut.clearCookieHeader },
        body: {
          success: true,
          loggedOut: true,
          revokedSid: loggedOut.revokedSid,
        },
      };
    },
  },
  {
    ...specById('auth.session.revoke'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const scope = body.scope === 'all' ? 'all' : 'individual';
      if (scope === 'all') {
        const targetUid =
          body.targetUid !== undefined
            ? validateSafeIdentifier(body.targetUid, 'targetUid')
            : actor.catalystUserId;
        const res = await ctx.authGuard.revokeAllUserSessionsGlobally(actor, targetUid);
        return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
      }
      const rawSid = body.sid !== undefined ? body.sid : actor.sessionId || '';
      const targetSid = validateSafeIdentifier(rawSid, 'sid');
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'individual_session_revoked';
      const res = await ctx.authGuard.revokeIndividualSession(actor, targetSid, reason);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('auth.me'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      if (actor.sessionId) {
        const csrfToken = ctx.authGuard.sessionTokens.issueCsrfToken(
          actor.catalystUserId,
          actor.sessionId,
          actor.sessionEpoch,
          actor.sessionExpiresAtEpochSec
        );
        return {
          status: 200,
          headers: { ...ctx.corsHeaders, 'X-Vigor-CSRF-Token': csrfToken },
          body: { success: true, actor, csrfToken },
        };
      }
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, actor } };
    },
  },
  {
    ...specById('athlete.workspace.get'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const cursor = queryStringParam(ctx.req.query, 'cursor');
      const maxPages = queryIntParam(ctx.req.query, 'maxPages', 1, 10);
      const workspace = await ctx.athleteService.hydrateAthleteWorkspace(actor, { cursor, maxPages });
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, workspace } };
    },
  },
  {
    ...specById('athlete.profile.patch'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const profile = await ctx.athleteService.updateOwnProfile(actor, body);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, profile } };
    },
  },
  {
    ...specById('athlete.onboarding.complete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const result = await ctx.athleteService.completeOnboarding(actor, {
        displayName: (body.displayName ?? body.name) as string,
        goal: body.goal as string,
        biometrics: body.biometrics as Record<string, unknown>,
        preferences: body.preferences as Record<string, unknown>,
      });
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...result } };
    },
  },
  {
    ...specById('athlete.meals.create'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const mealId =
        body.id !== undefined ? validateSafeIdentifier(body.id, 'id') : generateEntityId('meal');
      const item = await ctx.athleteService.logMeal(actor, mealId, body);
      return {
        status: 201,
        headers: ctx.corsHeaders,
        body: { success: true, meal: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.meals.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const startDate = queryStringParam(ctx.req.query, 'startDate');
      const endDate = queryStringParam(ctx.req.query, 'endDate');
      if (!startDate || !endDate || !ISO_DATE_PREFIX_RE.test(startDate) || !ISO_DATE_PREFIX_RE.test(endDate)) {
        throw new DomainValidationError(
          'INVALID_MEAL_QUERY',
          'Query parameters startDate and endDate matching YYYY-MM-DD are required.',
          400
        );
      }
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100) ?? 50;
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      const page = await ctx.athleteService.queryMealsByDateRange(actor, startDate, endDate, limit, startKey);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...page } };
    },
  },
  {
    ...specById('athlete.groceries.sync'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      if (!Array.isArray(body.items)) {
        throw new DomainValidationError('INVALID_GROCERY_BATCH', 'body.items must be an array.', 400);
      }
      if (body.items.length > 25) {
        throw new DomainValidationError(
          'BATCH_LIMIT_EXCEEDED',
          `Catalyst batch write limit is 25 items per HTTP request; received ${body.items.length}.`,
          400
        );
      }
      if (body.replaceExisting !== undefined && typeof body.replaceExisting !== 'boolean') {
        throw new DomainValidationError('INVALID_GROCERY_BATCH', 'replaceExisting must be boolean.', 400);
      }
      if (body.batchIndex !== undefined && (!Number.isInteger(body.batchIndex) || (body.batchIndex as number) < 0)) {
        throw new DomainValidationError('INVALID_GROCERY_BATCH', 'batchIndex must be a non-negative integer.', 400);
      }
      if (body.totalBatches !== undefined && (!Number.isInteger(body.totalBatches) || (body.totalBatches as number) < 1)) {
        throw new DomainValidationError('INVALID_GROCERY_BATCH', 'totalBatches must be an integer >= 1.', 400);
      }

      const normalizedItems = body.items.map((rawEntry, index) => {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
          throw new DomainValidationError(
            'INVALID_GROCERY',
            `Grocery entry at index ${index} must be an object.`,
            400
          );
        }
        const entry = rawEntry as Record<string, unknown>;
        const id = validateSafeIdentifier(entry.id, `items[${index}].id`);
        const payload =
          entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
            ? (entry.payload as Record<string, unknown>)
            : entry;
        return { id, payload };
      });

      const result = await ctx.athleteService.syncMealPlanToGroceries(actor, normalizedItems, {
        replaceExisting: body.replaceExisting !== false,
      });
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...result } };
    },
  },
  {
    ...specById('athlete.workouts.start'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const workoutId =
        body.id !== undefined ? validateSafeIdentifier(body.id, 'id') : generateEntityId('wk');
      const item = await ctx.athleteService.startExecutedWorkout(actor, workoutId, body);
      return {
        status: 201,
        headers: ctx.corsHeaders,
        body: { success: true, workout: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.workouts.logSet'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const workoutId = ctx.params.workoutId;
      if (body.executedWorkoutId !== undefined && String(body.executedWorkoutId).trim() !== workoutId) {
        throw new DomainValidationError(
          'WORKOUT_ID_MISMATCH',
          'body.executedWorkoutId does not match :workoutId path parameter.',
          400
        );
      }
      const setId =
        body.id !== undefined ? validateSafeIdentifier(body.id, 'id') : generateEntityId('set');
      const workoutStartedAt =
        typeof body.workoutStartedAt === 'string' && body.workoutStartedAt.trim()
          ? body.workoutStartedAt.trim()
          : undefined;
      const item = await ctx.athleteService.logWorkoutSet(actor, setId, workoutStartedAt, {
        ...body,
        executedWorkoutId: workoutId,
      });
      return {
        status: 201,
        headers: ctx.corsHeaders,
        body: { success: true, set: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.workouts.complete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const workoutId = ctx.params.workoutId;
      if (body.id !== undefined && String(body.id).trim() !== workoutId) {
        throw new DomainValidationError(
          'WORKOUT_ID_MISMATCH',
          'body.id does not match :workoutId path parameter.',
          400
        );
      }
      const finalStatus = body.finalStatus;
      if (finalStatus !== 'completed' && finalStatus !== 'abandoned') {
        throw new DomainValidationError(
          'INVALID_WORKOUT_STATUS',
          "finalStatus must be 'completed' or 'abandoned'.",
          400
        );
      }
      const startedAt =
        typeof body.startedAt === 'string' && body.startedAt.trim() ? body.startedAt.trim() : undefined;
      const summaryPatch: Record<string, unknown> = {};
      if (typeof body.durationSeconds === 'number' && Number.isFinite(body.durationSeconds)) {
        summaryPatch.durationSeconds = body.durationSeconds;
      }
      if (typeof body.sessionRpe === 'number' && Number.isFinite(body.sessionRpe)) {
        summaryPatch.sessionRpe = body.sessionRpe;
      }
      if (typeof body.notes === 'string') {
        summaryPatch.notes = body.notes;
      }
      const item = await ctx.athleteService.completeExecutedWorkout(
        actor,
        workoutId,
        startedAt,
        finalStatus,
        summaryPatch
      );
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, workout: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.cardio.create'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const cardioId =
        body.id !== undefined ? validateSafeIdentifier(body.id, 'id') : generateEntityId('cardio');
      const item = await ctx.athleteService.addCardioSession(actor, cardioId, body);
      return {
        status: 201,
        headers: ctx.corsHeaders,
        body: { success: true, cardio: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.notifications.create'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const notificationId =
        body.id !== undefined ? validateSafeIdentifier(body.id, 'id') : generateEntityId('notif');
      const item = await ctx.athleteService.createNotification(actor, notificationId, body);
      return {
        status: 201,
        headers: ctx.corsHeaders,
        body: { success: true, notification: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.recipes.put'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const recipeId = ctx.params.recipeId;
      if (body.id !== undefined && String(body.id).trim() !== recipeId) {
        throw new DomainValidationError(
          'RESOURCE_ID_MISMATCH',
          'body.id does not match :recipeId path parameter.',
          400
        );
      }
      const item = await ctx.athleteService.saveRecipe(actor, recipeId, body);
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, recipe: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.mealPlans.put'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const weekStart = ctx.params.weekStart;
      if (!YYYY_MM_DD_RE.test(weekStart)) {
        throw new DomainValidationError('INVALID_PATH_PARAMETER', 'weekStart must match YYYY-MM-DD.', 400);
      }
      if (body.weekStart !== undefined && String(body.weekStart).trim() !== weekStart) {
        throw new DomainValidationError(
          'RESOURCE_ID_MISMATCH',
          'body.weekStart does not match :weekStart path parameter.',
          400
        );
      }
      const item = await ctx.athleteService.saveMealPlan(actor, weekStart, body);
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, mealPlan: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.routines.put'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const routineId = ctx.params.routineId;
      if (body.id !== undefined && String(body.id).trim() !== routineId) {
        throw new DomainValidationError(
          'RESOURCE_ID_MISMATCH',
          'body.id does not match :routineId path parameter.',
          400
        );
      }
      const item = await ctx.athleteService.saveWorkoutRoutine(actor, routineId, body);
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, routine: item.payload, item },
      };
    },
  },
  {
    ...specById('invitations.redeem'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const inviteId = validateSafeIdentifier(body.inviteId, 'inviteId');
      const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
      if (!rawToken) {
        throw new DomainValidationError('INVALID_INVITATION_TOKEN', 'Invitation token is required.', 400);
      }
      const res = await ctx.adminService.redeemInvitation(actor, inviteId, rawToken);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('admin.users.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const rawRole = queryStringParam(ctx.req.query, 'role');
      const rawStatus = queryStringParam(ctx.req.query, 'accountStatus');
      const emailVerified = queryBooleanParam(ctx.req.query, 'emailVerified');
      const searchQuery = queryStringParam(ctx.req.query, 'searchQuery');
      const sortBy = queryStringParam(ctx.req.query, 'sortBy');
      const sortOrder = queryStringParam(ctx.req.query, 'sortOrder');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');

      if (rawRole !== undefined && rawRole !== 'all' && !VALID_ROLES.has(rawRole)) {
        throw new DomainValidationError('INVALID_QUERY_PARAMETER', `Invalid role filter '${rawRole}'.`, 400);
      }
      if (rawStatus !== undefined && rawStatus !== 'all' && !VALID_ACCOUNT_STATUSES.has(rawStatus)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          `Invalid accountStatus filter '${rawStatus}'.`,
          400
        );
      }
      if (sortBy !== undefined && !VALID_DIRECTORY_SORT_FIELDS.has(sortBy)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          `Invalid sortBy '${sortBy}'. Must be 'createdAt', 'displayName', or 'email'.`,
          400
        );
      }
      if (sortOrder !== undefined && !VALID_SORT_ORDERS.has(sortOrder)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          `Invalid sortOrder '${sortOrder}'. Must be 'asc' or 'desc'.`,
          400
        );
      }

      const page = await ctx.adminService.listDirectoryUsers(actor, {
        role: rawRole && rawRole !== 'all' ? (rawRole as UserRole) : undefined,
        accountStatus:
          rawStatus && rawStatus !== 'all' ? (rawStatus as 'active' | 'suspended') : undefined,
        emailVerified,
        searchQuery,
        sortBy: sortBy as 'createdAt' | 'displayName' | 'email' | undefined,
        sortOrder: sortOrder as 'asc' | 'desc' | undefined,
        limit,
        startKey,
      });

      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, items: page.items, users: page.items, nextStartKey: page.nextStartKey },
      };
    },
  },
  {
    ...specById('admin.stats.get'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const stats = await ctx.adminService.getAdminStats(actor);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, stats } };
    },
  },
  {
    ...specById('admin.users.detail'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const detail = await ctx.adminService.getAdminUserDetail(actor, ctx.params.uid);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...detail } };
    },
  },
  {
    ...specById('admin.invitations.create'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const targetEmail = typeof body.targetEmail === 'string' ? body.targetEmail.trim() : '';
      const rawRole = body.targetRole === undefined ? 'athlete' : String(body.targetRole);
      if (rawRole !== 'athlete' && rawRole !== 'admin') {
        throw new AdminGovernanceError(
          'PRIVILEGE_ESCALATION_BLOCKED',
          `Invitation targetRole '${rawRole}' is not permitted.`,
          403
        );
      }
      const res = await ctx.adminService.createInvitation(actor, targetEmail, rawRole);
      return { status: 201, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('admin.invitations.revoke'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const inviteId = ctx.params.inviteId;
      if (body.inviteId !== undefined && String(body.inviteId).trim() !== inviteId) {
        throw new DomainValidationError(
          'PARAM_BODY_MISMATCH',
          'body.inviteId does not match :inviteId path parameter.',
          400
        );
      }
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
      const res = await ctx.adminService.revokeInvitation(actor, inviteId, reason);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('admin.users.setStatus'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const targetUid = ctx.params.uid;
      if (body.targetUid !== undefined && String(body.targetUid).trim() !== targetUid) {
        throw new DomainValidationError(
          'PARAM_BODY_MISMATCH',
          'body.targetUid does not match :uid path parameter.',
          400
        );
      }
      const newStatus = body.newStatus;
      if (newStatus !== 'active' && newStatus !== 'suspended') {
        throw new DomainValidationError(
          'INVALID_ACCOUNT_STATUS',
          "newStatus must be 'active' or 'suspended'.",
          400
        );
      }
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
      const user = await ctx.adminService.setUserStatus(actor, targetUid, newStatus, reason);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, user } };
    },
  },
  {
    ...specById('admin.users.setRole'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const targetUid = ctx.params.uid;
      if (body.targetUid !== undefined && String(body.targetUid).trim() !== targetUid) {
        throw new DomainValidationError(
          'PARAM_BODY_MISMATCH',
          'body.targetUid does not match :uid path parameter.',
          400
        );
      }
      const newRole = body.newRole;
      if (typeof newRole !== 'string' || !VALID_ROLES.has(newRole)) {
        throw new DomainValidationError(
          'INVALID_ROLE',
          "newRole must be 'athlete', 'admin', or 'superadmin'.",
          400
        );
      }
      const user = await ctx.adminService.setUserRole(actor, targetUid, newRole as UserRole, {
        idempotencyKey:
          typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
            ? body.idempotencyKey.trim()
            : undefined,
        reason:
          typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined,
      });
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, user } };
    },
  },
  {
    ...specById('admin.users.passwordReset'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const targetUid = ctx.params.uid;
      if (body.targetUid !== undefined && String(body.targetUid).trim() !== targetUid) {
        throw new DomainValidationError(
          'PARAM_BODY_MISMATCH',
          'body.targetUid does not match :uid path parameter.',
          400
        );
      }
      const res = await ctx.adminService.requestAdminPasswordReset(actor, targetUid);
      return { status: 200, headers: ctx.corsHeaders, body: { ...res } };
    },
  },
  {
    ...specById('admin.auditLogs.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const month = queryStringParam(ctx.req.query, 'month');
      const targetUid = queryStringParam(ctx.req.query, 'targetUid');
      const actorUid = queryStringParam(ctx.req.query, 'actorUid');
      const action = queryStringParam(ctx.req.query, 'action');
      const startDate = queryStringParam(ctx.req.query, 'startDate');
      const endDate = queryStringParam(ctx.req.query, 'endDate');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');

      if (month !== undefined && !YYYY_MM_RE.test(month)) {
        throw new DomainValidationError('INVALID_QUERY_PARAMETER', 'month must match YYYY-MM.', 400);
      }
      if ((startDate && !endDate) || (!startDate && endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'startDate and endDate must both be provided together.',
          400
        );
      }
      if (startDate && endDate && (!ISO_DATE_PREFIX_RE.test(startDate) || !ISO_DATE_PREFIX_RE.test(endDate) || startDate > endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Valid startDate and endDate (startDate <= endDate) are required.',
          400
        );
      }

      const safeTargetUid = targetUid ? validateSafeIdentifier(targetUid, 'targetUid') : undefined;
      const safeActorUid = actorUid ? validateSafeIdentifier(actorUid, 'actorUid') : undefined;
      const useGlobalTimeline = !month && !safeTargetUid && !safeActorUid && !(startDate && endDate);

      const page = await ctx.adminService.listAuditLogs(actor, {
        month,
        targetUid: safeTargetUid,
        actorUid: safeActorUid,
        globalTimeline: useGlobalTimeline,
        dateRangeIso: startDate && endDate ? [startDate, endDate] : undefined,
        limit,
        startKey,
      });

      const items =
        action && action !== 'all' ? page.items.filter(entry => entry.action === action) : page.items;

      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, items, logs: items, nextStartKey: page.nextStartKey },
      };
    },
  },
  // ==================== PHASE 4.2.3: 11 RECONCILED ATHLETE ROUTES ====================
  {
    ...specById('athlete.biometrics.put'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const item = await ctx.athleteService.saveBiometrics(actor, body);
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, biometrics: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.preferences.put'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const item = await ctx.athleteService.savePreferences(actor, body);
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, preferences: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.meals.delete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.deleteMeal(actor, ctx.params.mealId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('athlete.recipes.delete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.deleteRecipe(actor, ctx.params.recipeId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('athlete.groceries.create'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const groceryId =
        body.id !== undefined ? validateSafeIdentifier(body.id, 'id') : generateEntityId('gr');
      const item = await ctx.athleteService.addManualGrocery(actor, groceryId, body);
      return {
        status: 201,
        headers: ctx.corsHeaders,
        body: { success: true, grocery: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.groceries.patchStatus'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const item = await ctx.athleteService.toggleGroceryStatus(actor, ctx.params.groceryId, body);
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, grocery: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.groceries.delete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.deleteGrocery(actor, ctx.params.groceryId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('athlete.routines.setDefault'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const routines = await ctx.athleteService.setDefaultRoutine(actor, ctx.params.routineId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, routines } };
    },
  },
  {
    ...specById('athlete.cardio.delete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.deleteCardioSession(actor, ctx.params.cardioId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('athlete.notifications.markRead'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const body = asPlainObject(ctx.req.body);
      const item = await ctx.athleteService.markNotificationRead(
        actor,
        ctx.params.notificationId,
        body
      );
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: { success: true, notification: item.payload, item },
      };
    },
  },
  {
    ...specById('athlete.notifications.markAllRead'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.markAllNotificationsRead(actor);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  // ==================== PHASE 5.7: 12 COMPLETED CANONICAL ROUTES (TOTAL 53) ====================
  {
    ...specById('athlete.workouts.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const rawStatus = queryStringParam(ctx.req.query, 'status');
      const startDate = queryStringParam(ctx.req.query, 'startDate');
      const endDate = queryStringParam(ctx.req.query, 'endDate');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');

      if (rawStatus !== undefined && !VALID_WORKOUT_STATUSES.has(rawStatus)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          `Invalid workout status '${rawStatus}'.`,
          400
        );
      }
      if ((startDate && !endDate) || (!startDate && endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'startDate and endDate must both be provided together.',
          400
        );
      }
      if (startDate && endDate && (!ISO_DATE_PREFIX_RE.test(startDate) || !ISO_DATE_PREFIX_RE.test(endDate) || startDate > endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Valid startDate and endDate (startDate <= endDate) matching YYYY-MM-DD are required.',
          400
        );
      }

      const page = await ctx.athleteService.listExecutedWorkouts(actor, {
        status: rawStatus as 'in_progress' | 'completed' | 'abandoned' | undefined,
        startDate,
        endDate,
        limit,
        startKey,
      });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          workouts: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.workouts.getDetail'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const detail = await ctx.athleteService.getExecutedWorkoutDetail(actor, ctx.params.workoutId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...detail } };
    },
  },
  {
    ...specById('athlete.routines.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      const page = await ctx.athleteService.listWorkoutRoutines(actor, { limit, startKey });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          routines: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.routines.delete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.deleteWorkoutRoutine(actor, ctx.params.routineId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('athlete.recipes.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      const page = await ctx.athleteService.listRecipes(actor, { limit, startKey });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          recipes: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.mealPlans.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      const page = await ctx.athleteService.listMealPlans(actor, { limit, startKey });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          mealPlans: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.groceries.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const rawStatus = queryStringParam(ctx.req.query, 'status');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      if (rawStatus !== undefined && !VALID_GROCERY_FILTER_STATUSES.has(rawStatus)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          `Invalid grocery status filter '${rawStatus}'.`,
          400
        );
      }
      const page = await ctx.athleteService.listGroceries(actor, {
        status: rawStatus,
        limit,
        startKey,
      });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          groceries: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.groceries.clearCompleted'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.clearCompletedGroceries(actor);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('athlete.cardio.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const startDate = queryStringParam(ctx.req.query, 'startDate');
      const endDate = queryStringParam(ctx.req.query, 'endDate');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      if ((startDate && !endDate) || (!startDate && endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'startDate and endDate must both be provided together.',
          400
        );
      }
      if (startDate && endDate && (!ISO_DATE_PREFIX_RE.test(startDate) || !ISO_DATE_PREFIX_RE.test(endDate) || startDate > endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Valid startDate and endDate (startDate <= endDate) matching YYYY-MM-DD are required.',
          400
        );
      }
      const page = await ctx.athleteService.listCardioSessions(actor, {
        startDate,
        endDate,
        limit,
        startKey,
      });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          cardioSessions: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.notifications.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const unreadOnly = queryBooleanParam(ctx.req.query, 'unreadOnly');
      const startDate = queryStringParam(ctx.req.query, 'startDate');
      const endDate = queryStringParam(ctx.req.query, 'endDate');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      if ((startDate && !endDate) || (!startDate && endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'startDate and endDate must both be provided together.',
          400
        );
      }
      if (startDate && endDate && (!ISO_DATE_PREFIX_RE.test(startDate) || !ISO_DATE_PREFIX_RE.test(endDate) || startDate > endDate)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Valid startDate and endDate (startDate <= endDate) matching YYYY-MM-DD are required.',
          400
        );
      }
      const page = await ctx.athleteService.listNotifications(actor, {
        unreadOnly,
        startDate,
        endDate,
        limit,
        startKey,
      });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: page.items,
          notifications: page.items.map(i => i.payload),
          nextStartKey: page.nextStartKey,
        },
      };
    },
  },
  {
    ...specById('athlete.notifications.delete'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const res = await ctx.athleteService.deleteNotification(actor, ctx.params.notificationId);
      return { status: 200, headers: ctx.corsHeaders, body: { success: true, ...res } };
    },
  },
  {
    ...specById('admin.invitations.list'),
    handler: async ctx => {
      const actor = await authenticateForSpec(ctx);
      const email = queryStringParam(ctx.req.query, 'email');
      const rawStatus = queryStringParam(ctx.req.query, 'status');
      const limit = queryIntParam(ctx.req.query, 'limit', 1, 100);
      const startKey = queryStringParam(ctx.req.query, 'startKey');
      if (rawStatus !== undefined && rawStatus !== 'all' && !VALID_INVITE_STATUSES.has(rawStatus)) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          `Invalid invitation status filter '${rawStatus}'.`,
          400
        );
      }
      const res = await ctx.adminService.listInvitations(actor, {
        email,
        status:
          rawStatus && rawStatus !== 'all'
            ? (rawStatus as AdminInvitationItem['status'])
            : undefined,
        limit,
        startKey,
      });
      return {
        status: 200,
        headers: ctx.corsHeaders,
        body: {
          success: true,
          items: res.items,
          invitations: res.items,
          nextStartKey: res.nextStartKey,
          queryStrategy: res.queryStrategy,
          ...(res.indexLimitationNote ? { indexLimitationNote: res.indexLimitationNote } : {}),
        },
      };
    },
  },
];

interface CompiledRouteEntry {
  def: RouteDefinition;
  segments: string[];
  paramPositions: Array<{ index: number; name: string }>;
  isStatic: boolean;
}

function compileRouteTable(definitions: readonly RouteDefinition[]): CompiledRouteEntry[] {
  const seenMethodPath = new Set<string>();
  const compiled: CompiledRouteEntry[] = [];

  for (const def of definitions) {
    const key = `${def.method} ${def.path}`;
    if (seenMethodPath.has(key)) {
      throw new Error(`DUPLICATE_ROUTE_DEFINITION: ${key}`);
    }
    seenMethodPath.add(key);

    const segments = def.path.split('/').filter(Boolean);
    const paramPositions: Array<{ index: number; name: string }> = [];
    segments.forEach((seg, index) => {
      if (seg.startsWith(':')) {
        const name = seg.slice(1).trim();
        if (!name) {
          throw new Error(`INVALID_ROUTE_PARAM_SYNTAX: ${key}`);
        }
        paramPositions.push({ index, name });
      }
    });

    const declaredParams = new Set(def.pathParams);
    const patternParams = new Set(paramPositions.map(p => p.name));
    if (
      declaredParams.size !== patternParams.size ||
      [...declaredParams].some(name => !patternParams.has(name))
    ) {
      throw new Error(`ROUTE_PARAM_CONTRACT_MISMATCH: ${key}`);
    }

    compiled.push({
      def,
      segments,
      paramPositions,
      isStatic: paramPositions.length === 0,
    });
  }

  // Verify exact parity with ROUTE_CONTRACT_SPECS
  if (definitions.length !== ROUTE_CONTRACT_SPECS.length) {
    throw new Error(
      `ROUTE_TABLE_INCOMPLETE: Expected ${ROUTE_CONTRACT_SPECS.length} routes, got ${definitions.length}.`
    );
  }
  for (const spec of ROUTE_CONTRACT_SPECS) {
    if (!seenMethodPath.has(`${spec.method} ${spec.path}`)) {
      throw new Error(`MISSING_ROUTE_IMPLEMENTATION: ${spec.method} ${spec.path}`);
    }
  }

  // Sort static routes before parameterized routes to eliminate ambiguity
  compiled.sort((a, b) => Number(b.isStatic) - Number(a.isStatic));
  return compiled;
}

const COMPILED_ROUTE_TABLE = compileRouteTable(ROUTE_DEFINITIONS);

export const CLEAN_SLATE_ENDPOINT_CATALOG: ApiEndpointDefinition[] = ROUTE_DEFINITIONS.map(def => ({
  method: def.method,
  path: def.path,
  auth: def.auth,
  replacesFirebaseMechanism: def.replacesFirebaseMechanism,
  limitsAndNotes: def.limitsAndNotes,
}));

export function matchCompiledRoute(
  method: ContractHttpMethod,
  rawPath: string
): { def: RouteDefinition; params: RouteParams } | null {
  const pathOnly = rawPath.split('?')[0] || '/';
  const incomingSegments = pathOnly.split('/').filter(Boolean);

  for (const entry of COMPILED_ROUTE_TABLE) {
    if (entry.def.method !== method) continue;
    if (entry.segments.length !== incomingSegments.length) continue;

    const params: RouteParams = {};
    let matched = true;
    for (let i = 0; i < entry.segments.length; i++) {
      const expectedSeg = entry.segments[i];
      const actualRawSeg = incomingSegments[i];
      if (expectedSeg.startsWith(':')) {
        const paramName = expectedSeg.slice(1);
        let decoded: string;
        try {
          decoded = decodeURIComponent(actualRawSeg);
        } catch {
          throw new DomainValidationError(
            'INVALID_PATH_PARAMETER',
            `Malformed percent-encoding in path parameter '${paramName}'.`,
            400
          );
        }
        params[paramName] = validateSafeIdentifier(decoded, paramName);
      } else if (expectedSeg !== actualRawSeg) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { def: entry.def, params };
    }
  }
  return null;
}

export class CleanSlateApiDispatcher {
  private readonly httpPolicy: HttpSecurityPolicy;

  constructor(
    private authGuard: CleanSlateAuthGuard,
    private athleteService: AthleteDataService,
    private adminService: AdminGovernanceService,
    httpPolicy?: HttpSecurityPolicy
  ) {
    this.httpPolicy = httpPolicy ?? new HttpSecurityPolicy();
  }

  async dispatch(
    method: ApiEndpointDefinition['method'] | 'OPTIONS',
    path: string,
    req: IncomingHttpRequest
  ): Promise<EndpointResponse> {
    let corsHeaders: Record<string, string> = { Vary: 'Origin' };
    try {
      corsHeaders = this.httpPolicy.buildCorsHeaders(req);

      if (method === 'OPTIONS') {
        return {
          status: 204,
          headers: corsHeaders,
          body: { success: true },
        };
      }

      const matched = matchCompiledRoute(method, path);
      if (!matched) {
        corsHeaders = this.httpPolicy.assertCsrfAndOriginForRequest(method, req);
        return {
          status: 404,
          headers: corsHeaders,
          body: { success: false, error: 'ROUTE_NOT_FOUND' },
        };
      }

      corsHeaders = this.httpPolicy.assertCsrfAndOriginForRequest(method, req, matched.def.csrfPolicy);

      return await matched.def.handler({
        req,
        params: matched.params,
        corsHeaders,
        httpPolicy: this.httpPolicy,
        authGuard: this.authGuard,
        athleteService: this.athleteService,
        adminService: this.adminService,
        spec: matched.def,
      });
    } catch (err) {
      if (err instanceof HttpSecurityError) {
        return {
          status: err.statusCode,
          headers: err.code === 'CORS_ORIGIN_REJECTED' ? { Vary: 'Origin' } : corsHeaders,
          body: { success: false, error: err.code, message: err.message },
        };
      }
      if (err instanceof AuthGuardError) {
        const headers = err.clearCookieHeader
          ? { ...corsHeaders, 'Set-Cookie': err.clearCookieHeader }
          : corsHeaders;
        return {
          status: err.statusCode,
          headers,
          body: { success: false, error: err.code, message: err.message },
        };
      }
      if (err instanceof DomainValidationError) {
        return {
          status: err.statusCode,
          headers: corsHeaders,
          body: { success: false, error: err.code, message: err.message },
        };
      }
      if (err instanceof AdminGovernanceError) {
        return {
          status: err.statusCode,
          headers: corsHeaders,
          body: { success: false, error: err.code, message: err.message },
        };
      }
      return {
        status: 500,
        headers: corsHeaders,
        body: {
          success: false,
          error: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown',
        },
      };
    }
  }
}
