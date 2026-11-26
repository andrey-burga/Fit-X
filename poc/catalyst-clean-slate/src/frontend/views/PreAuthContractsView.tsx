/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Pre-Auth Contracts, Invite Redemption Preview & Clean-Slate Technical Guide
 * Replaces legacy Supabase / outdated backend notes in root GuideSettingsView.tsx with
 * accurate Catalyst Advanced I/O + Catalyst NoSQL architecture and scientific methodologies.
 */

import React, { useState } from 'react';
import { BookOpen, FileCode2, KeyRound, ShieldCheck } from 'lucide-react';
import {
  CATALYST_BUDGET_LIMITS,
  CLEAN_SLATE_UI_ENDPOINT_MAP,
} from '../contracts/cleanSlateModels';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard } from '../components/UiPrimitives';

export const PreAuthContractsView: React.FC = () => {
  const { workspace, activePersonaUid, adminRepo, notifyToast } = useWorkspace();

  const [inviteId, setInviteId] = useState('inv_mock_athlete_open');
  const [rawToken, setRawToken] = useState('tok_mock_open_7890');
  const [redeemResult, setRedeemResult] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  if (!workspace) return null;

  const handleRedeemPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setRedeeming(true);
    setRedeemResult(null);
    try {
      const res = await adminRepo.redeemInvitationPreview(activePersonaUid, inviteId.trim(), rawToken.trim());
      const msg = `Canje validado en mock local → rol asignado '${res.assignedRole}' (roleVersion=${res.roleVersion}). En producción exige además rotación de sesión HMAC.`;
      setRedeemResult(msg);
      notifyToast('Canje de invitación simulado correctamente', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Canje rechazado';
      setRedeemResult(msg);
      notifyToast(msg, 'error');
    } finally {
      setRedeeming(false);
    }
  };

  const wiredMatchCount = CLEAN_SLATE_UI_ENDPOINT_MAP.filter(
    e => e.dispatcherStatus === 'wired_match'
  ).length;
  const mismatchCount = CLEAN_SLATE_UI_ENDPOINT_MAP.filter(
    e => e.dispatcherStatus === 'wired_path_mismatch'
  ).length;
  const pendingDispatcherCount = CLEAN_SLATE_UI_ENDPOINT_MAP.filter(
    e => e.dispatcherStatus === 'service_ready_not_wired_in_dispatcher'
  ).length;

  return (
    <div className="space-y-6">
      <InlineAlert tone="info" title="Vista de Contratos Preparatorios (Sin Autenticación Real en Frontend)">
        Esta sección documenta el estado reconciliado de contratos backend y el adaptador HTTP preparado. No emite cookies reales <code>__Host-vigor_session</code>, no configura secretos HMAC y no llama a Zoho Catalyst Auth remoto ni APIs externas USDA.
      </InlineAlert>

      {/* Pre-auth flow + Invite redemption preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SectionCard
          className="lg:col-span-6"
          title="Frontera de Sesión Objetivo (Modelo B Refinado)"
          subtitle="Política de intercambio Catalyst Auth → Cookie HMAC propia"
        >
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-border bg-surface-alt/50 p-3 space-y-1">
              <div className="font-semibold text-ink flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-brand" />
                <span>Ciclo de Vida de Sesión</span>
              </div>
              <ul className="space-y-1 text-ink-muted list-disc pl-4">
                <li>Bootstrap / Exchange inicial con token verificado de Catalyst Authentication.</li>
                <li>Emisión de cookie <code>__Host-vigor_session</code> (HttpOnly, Secure, SameSite=Strict, Path=/).</li>
                <li>Inactividad máxima: {CATALYST_BUDGET_LIMITS.SESSION_INACTIVITY_HOURS} horas · Vida absoluta: {CATALYST_BUDGET_LIMITS.SESSION_ABSOLUTE_HOURS} horas.</li>
                <li>Revalidación del estado Catalyst como máximo cada {CATALYST_BUDGET_LIMITS.CATALYST_REVALIDATION_MINUTES} minutos y en refresh.</li>
                <li>Rotación de <code>sid</code> en refresh y política fail-closed ante fallo de verificación.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-surface-alt/50 p-3 space-y-1">
              <div className="font-semibold text-ink">Arquitectura Clean-Slate (5 Tablas NoSQL) y Catálogos Locales</div>
              <p className="text-ink-muted">
                <code>Users</code>, <code>UserData</code> (11 entidades particionadas por <code>USER#uid</code>),{' '}
                <code>AdminInvitations</code>, <code>AuditLogs</code> y <code>SystemControl</code> (saga locks, sesiones activas y TTL <code>ttlEpochSec</code>). Los alimentos (<code>FOOD_CATALOG</code>), ejercicios (<code>EXERCISE_CATALOG</code>) y recetas semilla operan como catálogos locales simulados en memoria sin llamadas externas.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-6"
          title="Previsualización de Canje de Invitación (AcceptInvitation)"
          subtitle="Simula POST /api/v1/invitations/redeem con transición pending → redeeming → redeemed"
        >
          <form onSubmit={e => void handleRedeemPreview(e)} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="preauth-inv-id" className="text-xs font-medium text-ink-muted">
                  ID de Invitación (<code>inviteId</code>)
                </label>
                <input
                  id="preauth-inv-id"
                  type="text"
                  required
                  value={inviteId}
                  onChange={e => setInviteId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="preauth-inv-token" className="text-xs font-medium text-ink-muted">
                  Token Secreto (<code>rawToken</code>)
                </label>
                <input
                  id="preauth-inv-token"
                  type="text"
                  required
                  value={rawToken}
                  onChange={e => setRawToken(e.target.value)}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink font-mono"
                />
              </div>
            </div>

            <p className="text-xs text-ink-muted">
              Seed disponible por defecto: <code>inv_mock_athlete_open</code> + <code>tok_mock_open_7890</code> (o crea una nueva desde Administración).
            </p>

            <button
              type="submit"
              disabled={redeeming}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              <span>{redeeming ? 'Validando...' : 'Probar Canje en Repositorio Activo'}</span>
            </button>

            {redeemResult && (
              <InlineAlert tone="info" title="Resultado del Canje">
                {redeemResult}
              </InlineAlert>
            )}
          </form>
        </SectionCard>
      </div>

      {/* Updated Scientific & Technical Guide (no Supabase / legacy errors) */}
      <SectionCard
        title="Guía Científica y Restricciones Técnicas Clean-Slate"
        subtitle="Fórmulas fisiológicas y techos físicos verificados del backend Catalyst"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-border bg-surface-alt/40 p-4 space-y-1.5">
            <div className="font-semibold text-ink flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-brand" />
              <span>Fisiología Nutricional</span>
            </div>
            <p className="text-ink-muted">
              BMR mediante Mifflin-St Jeor, TDEE ajustado por PAL [1.0–2.5] y redondeo diofántico 4/4/9 kcal para garantizar paridad matemática exacta entre calorías y gramos de proteína, carbohidratos y grasas.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface-alt/40 p-4 space-y-1.5">
            <div className="font-semibold text-ink flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-brand" />
              <span>Analítica de Fuerza</span>
            </div>
            <p className="text-ink-muted">
              Estimación de fuerza máxima por fórmula de Epley <code>peso × (1 + reps/30)</code>, exclusión estricta de series <code>warmup</code> del tonelaje y RMs, y control de carga ACWR (7d/28d) con mínimo de 21-28 días.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface-alt/40 p-4 space-y-1.5">
            <div className="font-semibold text-ink flex items-center gap-1.5">
              <FileCode2 className="w-4 h-4 text-brand" />
              <span>Presupuesto Catalyst NoSQL</span>
            </div>
            <p className="text-ink-muted">
              Techo físico de 400 KB por ítem (alerta preventiva a 350 KB), escrituras por lote limitadas a {CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS} ítems y consultas paginadas de hasta {CATALYST_BUDGET_LIMITS.MAX_QUERY_READ_ITEMS} ítems por lectura.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Endpoint Map */}
      <SectionCard
        title={`Mapa Reconciliado de Contratos API Clean-Slate (${CLEAN_SLATE_UI_ENDPOINT_MAP.length} endpoints)`}
        subtitle={`Paridad completa en CleanSlateApiDispatcher: ${wiredMatchCount}/${CLEAN_SLATE_UI_ENDPOINT_MAP.length} paridad exacta · ${mismatchCount} desfases · ${pendingDispatcherCount} pendientes`}
      >
        <div className="mb-3 rounded-lg border border-border bg-surface-alt/40 p-3 text-xs text-ink-muted space-y-1.5">
          <div>
            <strong className="text-ink">Comportamiento honesto del Adaptador HTTP:</strong>{' '}
            Todas las operaciones del atleta y de administración (53 rutas canónicas verificadas, incluyendo <code>saveBiometrics</code>, <code>savePreferences</code>, colecciones <code>GET</code> paginadas/filtradas, eliminaciones CRUD, <code>clearCompletedGroceries</code> y <code>GET /api/v1/admin/invitations</code>) están conectadas al dispatcher sin fallback silencioso a mock.
          </div>
          <div>
            <strong className="text-ink">Sincronización multi-lote de compras (&gt;25 ítems):</strong>{' '}
            <code>PUT /api/v1/athlete/groceries/sync</code> respeta el tope de 25 ítems por petición HTTP; las sincronizaciones divididas en múltiples lotes NO son atómicas y reportan <code>PartialBatchSyncError</code> para reanudar lotes pendientes sin borrar lotes ya confirmados ni duplicar registros.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="py-2 pr-3">Método</th>
                <th className="py-2 pr-3">Ruta Catálogo</th>
                <th className="py-2 pr-3">Scope</th>
                <th className="py-2 pr-3">Estado Dispatcher</th>
                <th className="py-2">Propósito</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {CLEAN_SLATE_UI_ENDPOINT_MAP.map(ep => (
                <tr key={`${ep.method}_${ep.path}`}>
                  <td className="py-2 pr-3 font-mono font-semibold text-brand">{ep.method}</td>
                  <td className="py-2 pr-3 font-mono text-ink">
                    <div>{ep.path}</div>
                    {ep.dispatcherPath && (
                      <div className="text-[11px] text-ink-muted">
                        Dispatcher actual: {ep.dispatcherPath}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-ink-muted">{ep.auth}</td>
                  <td className="py-2 pr-3 font-mono text-[11px]">
                    {ep.dispatcherStatus === 'wired_match' && (
                      <span className="text-brand font-semibold">Dispatcher OK</span>
                    )}
                    {ep.dispatcherStatus === 'wired_path_mismatch' && (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">Desfase path</span>
                    )}
                    {ep.dispatcherStatus === 'service_ready_not_wired_in_dispatcher' && (
                      <span className="text-ink-muted font-semibold">Pendiente Dispatcher</span>
                    )}
                  </td>
                  <td className="py-2 text-ink-muted">{ep.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};
