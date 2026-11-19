/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — RBAC Administrative Governance Console (Strict Local Mock)
 * IMPORTANT:
 * - Strictly non-persistent local mock state (NO real cookies, NO real credentials, NO remote Catalyst calls).
 * - Enforces all frozen RBAC contracts: athlete denial, admin invitation limit, self-suspension lock,
 *   and Phase 4.0.2 superadmin role mutation lock (`SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Lock, MailPlus, RefreshCw, ShieldAlert, ShieldCheck, UserX } from 'lucide-react';
import type {
  AccountStatus,
  AdminInvitationModel,
  AdminStatsModel,
  AuditLogModel,
  UserAccountModel,
  UserRole,
} from '../contracts/cleanSlateModels';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

export const AdminConsoleView: React.FC = () => {
  const { workspace, activePersonaUid, adminRepo, notifyToast, navigate, isLocalDevMock } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStatsModel | null>(null);
  const [users, setUsers] = useState<UserAccountModel[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitationModel[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogModel[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');

  const [selectedUserDetail, setSelectedUserDetail] = useState<{
    user: UserAccountModel;
    recentLogs: AuditLogModel[];
  } | null>(null);

  // Invitation form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'athlete' | 'admin'>('athlete');
  const [statusReason, setStatusReason] = useState('Revisión operativa de cuenta');
  const [roleReason, setRoleReason] = useState('Prueba de bloqueo de gobernanza');

  const actorRole = workspace?.profile.role ?? 'athlete';
  const hasAdminAccess = actorRole === 'admin' || actorRole === 'superadmin';

  const [invitesUnsupportedMsg, setInvitesUnsupportedMsg] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    if (!hasAdminAccess) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setInvitesUnsupportedMsg(null);
    try {
      const [s, u, logs] = await Promise.all([
        adminRepo.getStats(activePersonaUid),
        adminRepo.listUsers(activePersonaUid, {
          searchQuery,
          role: roleFilter,
          accountStatus: statusFilter,
        }),
        adminRepo.listAuditLogs(activePersonaUid, { action: auditActionFilter }),
      ]);
      setStats(s);
      setUsers(u);
      setAuditLogs(logs);

      try {
        const inv = await adminRepo.listInvitations(activePersonaUid);
        setInvitations(inv);
      } catch (invErr) {
        const code = (invErr as { code?: string })?.code;
        if (code === 'UNSUPPORTED_CONTRACT_ENDPOINT') {
          setInvitations([]);
          setInvitesUnsupportedMsg(
            invErr instanceof Error ? invErr.message : 'Listado de invitaciones no soportado en catálogo API.'
          );
        } else {
          throw invErr;
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error cargando consola administrativa');
    } finally {
      setLoading(false);
    }
  }, [hasAdminAccess, adminRepo, activePersonaUid, searchQuery, roleFilter, statusFilter, auditActionFilter]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  if (!workspace) return null;

  if (!hasAdminAccess) {
    return (
      <StatePanel
        mode="error"
        title="Acceso Restringido — Rol Insuficiente (403)"
        description={`El perfil activo (${workspace.profile.displayName} · rol '${actorRole}') no tiene privilegios de Administración. Cambia la persona de vista en la barra superior solo para previsualizar el contrato RBAC en mock local.`}
        actionLabel="Volver al Dashboard del Atleta"
        onAction={() => navigate('dashboard')}
      />
    );
  }

  const handleInspectUser = async (uid: string) => {
    try {
      const detail = await adminRepo.getUserDetail(activePersonaUid, uid);
      setSelectedUserDetail(detail);
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Error inspeccionando usuario', 'error');
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await adminRepo.createInvitation(activePersonaUid, inviteEmail, inviteRole);
      notifyToast(`Invitación creada (${created.targetRole}) para ${created.emailNormalized}`, 'success');
      setInviteEmail('');
      await loadAdminData();
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Invitación rechazada', 'error');
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await adminRepo.revokeInvitation(activePersonaUid, inviteId, 'Revocada desde consola mock');
      notifyToast('Invitación revocada (pending → revoked)', 'info');
      await loadAdminData();
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Error al revocar', 'error');
    }
  };

  const handleToggleStatus = async (target: UserAccountModel) => {
    const nextStatus: AccountStatus = target.accountStatus === 'active' ? 'suspended' : 'active';
    try {
      await adminRepo.setUserStatus(activePersonaUid, target.uid, nextStatus, statusReason);
      notifyToast(`Estado de ${target.displayName} actualizado a '${nextStatus}' (+sessionEpoch)`, 'success');
      await loadAdminData();
      if (selectedUserDetail?.user.uid === target.uid) {
        await handleInspectUser(target.uid);
      }
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Operación bloqueada por RBAC', 'error');
    }
  };

  const handleAttemptRoleChange = async (targetUid: string, nextRole: UserRole) => {
    try {
      await adminRepo.setUserRole(activePersonaUid, targetUid, nextRole, roleReason);
      notifyToast(`Rol actualizado a ${nextRole}`, 'success');
      await loadAdminData();
    } catch (err) {
      notifyToast(err instanceof Error ? err.message : 'Mutación bloqueada por salvaguarda', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <InlineAlert
        tone="warning"
        title={
          isLocalDevMock
            ? 'Consola Administrativa en Mock Local (sin credenciales ni cookies reales)'
            : 'Consola Administrativa · Adaptador HTTP Clean-Slate (/api/v1/admin/*)'
        }
      >
        Operando como <strong>{workspace.profile.displayName}</strong> (rol <code>{actorRole}</code>).{' '}
        {isLocalDevMock
          ? 'Todas las reglas de RBAC, bloqueos de auto-suspensión y bloqueo de cambio de rol Superadmin (Fase 4.0.2) se validan localmente en memoria sin emitir tokens ni modificar sistemas remotos.'
          : 'Conectado al adaptador HTTP desacoplado; sin credenciales reales ni fallback silencioso a mock.'}
      </InlineAlert>

      {errorMsg && (
        <InlineAlert tone="error" title="Error en repositorio administrativo">
          {errorMsg}
        </InlineAlert>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile label="Usuarios" value={stats.totalUsers} />
          <StatTile label="Activos" value={stats.activeUsers} tone="brand" />
          <StatTile label="Suspendidos" value={stats.suspendedUsers} tone="warn" />
          <StatTile label="Superadmins" value={stats.superadmins} tone="info" />
          <StatTile label="Admins" value={stats.admins} />
          <StatTile label="Inv. Pendientes" value={stats.pendingInvitations} />
        </div>
      )}

      {/* User Directory + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SectionCard
          className="lg:col-span-7"
          title="Directorio de Usuarios (Contrato GSI_Directory)"
          subtitle="Filtros por búsqueda, rol y estado de cuenta"
          action={
            <button
              type="button"
              onClick={() => void loadAdminData()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs text-ink cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refrescar</span>
            </button>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              aria-label="Buscar usuario en directorio"
              type="text"
              placeholder="Nombre, correo o UID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink"
            />
            <select
              aria-label="Filtrar por rol"
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
              className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
            >
              <option value="all">Todos los roles</option>
              <option value="athlete">Atleta</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
            </select>
            <select
              aria-label="Filtrar por estado"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as AccountStatus | 'all')}
              className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="suspended">Suspendidos</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-status-reason" className="text-[11px] text-ink-muted">
              Motivo de auditoría para cambio de estado:
            </label>
            <input
              id="admin-status-reason"
              type="text"
              value={statusReason}
              onChange={e => setStatusReason(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
            />
          </div>

          <div className="divide-y divide-border">
            {users.map(u => (
              <div key={u.uid} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{u.displayName}</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-alt border border-border text-ink">
                      {u.role}
                    </span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                        u.accountStatus === 'active'
                          ? 'bg-brand-soft text-brand-ink'
                          : 'bg-danger-soft text-danger'
                      }`}
                    >
                      {u.accountStatus}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted font-mono truncate">
                    {u.email} · {u.directorySegment} · epoch #{u.sessionEpoch}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleInspectUser(u.uid)}
                    className="px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs text-ink cursor-pointer"
                  >
                    Detalle
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleStatus(u)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs text-ink cursor-pointer"
                  >
                    <UserX className="w-3.5 h-3.5 text-warn" />
                    <span>{u.accountStatus === 'active' ? 'Suspender' : 'Reactivar'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-5"
          title="Inspector & Gobernanza de Roles"
          subtitle="Salvaguarda Fase 4.0.2: mutaciones Superadmin bloqueadas hasta verificación remota"
        >
          {!selectedUserDetail ? (
            <StatePanel
              mode="empty"
              title="Selecciona un usuario"
              description="Haz clic en Detalle para inspeccionar su historial en GSI_AuditTarget y probar políticas de rol."
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface-alt/40 p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <strong className="text-sm text-ink">{selectedUserDetail.user.displayName}</strong>
                  <span className="font-mono text-ink-muted">{selectedUserDetail.user.uid}</span>
                </div>
                <div className="text-ink-muted">{selectedUserDetail.user.email}</div>
                <div className="font-mono text-ink pt-1">
                  Rol: {selectedUserDetail.user.role} (v{selectedUserDetail.user.roleVersion}) · sessionEpoch:{' '}
                  {selectedUserDetail.user.sessionEpoch}
                </div>
              </div>

              <div className="rounded-xl border border-warn/30 bg-warn-soft/30 p-3.5 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <Lock className="w-4 h-4 text-warn" />
                  <span>Cambio de Rol (Gobernanza Fase 4.0.2)</span>
                </div>
                <p className="text-xs text-ink-muted">
                  Las promociones o degradaciones que involucran <code>superadmin</code> devuelven{' '}
                  <code>SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED</code>.
                </p>
                <input
                  aria-label="Motivo de cambio de rol"
                  type="text"
                  value={roleReason}
                  onChange={e => setRoleReason(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAttemptRoleChange(selectedUserDetail.user.uid, 'admin')}
                    className="px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs text-ink cursor-pointer"
                  >
                    Asignar Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAttemptRoleChange(selectedUserDetail.user.uid, 'superadmin')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-warn/40 bg-surface hover:bg-surface-alt text-xs text-warn font-medium cursor-pointer"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Probar Promoción Superadmin (Bloqueada)</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-ink">Eventos recientes (GSI_AuditTarget)</div>
                {selectedUserDetail.recentLogs.length === 0 ? (
                  <p className="text-xs text-ink-muted">Sin eventos registrados para este usuario.</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedUserDetail.recentLogs.map(log => (
                      <div key={log.eventId} className="text-xs rounded border border-border bg-canvas px-2.5 py-1.5">
                        <div className="font-mono text-ink">{log.action}</div>
                        <div className="text-[11px] text-ink-muted">{log.reason || log.actorEmail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Invitations + Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SectionCard
          className="lg:col-span-6"
          title="Invitaciones RBAC (AdminInvitations)"
          subtitle="Un Admin solo puede invitar atletas; solo Superadmin puede invitar administradores"
        >
          <form onSubmit={e => void handleCreateInvite(e)} className="flex flex-col sm:flex-row gap-2">
            <input
              aria-label="Correo a invitar"
              type="email"
              required
              placeholder="nuevo.usuario@dominio.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
            />
            <select
              aria-label="Rol de la invitación"
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as 'athlete' | 'admin')}
              className="rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink"
            >
              <option value="athlete">athlete</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium cursor-pointer"
            >
              <MailPlus className="w-3.5 h-3.5" />
              <span>Crear Invitación</span>
            </button>
          </form>

          {invitesUnsupportedMsg && (
            <InlineAlert tone="info" title="Contrato pendiente (501)">
              {invitesUnsupportedMsg}
            </InlineAlert>
          )}

          <div className="divide-y divide-border">
            {invitations.map(inv => (
              <div key={inv.inviteId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-ink truncate">
                    {inv.emailNormalized} · <span className="font-mono">{inv.targetRole}</span>
                  </div>
                  <div className="text-[11px] font-mono text-ink-muted truncate">
                    ID: {inv.inviteId} · Estado: {inv.status}
                    {inv.rawTokenPreview && inv.status === 'pending' ? ` · Token mock: ${inv.rawTokenPreview}` : ''}
                  </div>
                </div>
                {inv.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeInvite(inv.inviteId)}
                    className="px-2.5 py-1 rounded border border-border bg-surface hover:bg-surface-alt text-xs text-danger cursor-pointer shrink-0"
                  >
                    Revocar
                  </button>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-6"
          title={`Bitácora de Auditoría (${auditLogs.length})`}
          subtitle="Logs inmutables particionados por mes AUDIT#YYYY-MM"
          action={
            <select
              aria-label="Filtrar acción de auditoría"
              value={auditActionFilter}
              onChange={e => setAuditActionFilter(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
            >
              <option value="all">Todas las acciones</option>
              <option value="invitation_created">invitation_created</option>
              <option value="invitation_revoked">invitation_revoked</option>
              <option value="invitation_redeemed">invitation_redeemed</option>
              <option value="account_suspended">account_suspended</option>
              <option value="account_reactivated">account_reactivated</option>
              <option value="role_changed">role_changed</option>
            </select>
          }
        >
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {auditLogs.map(log => (
              <div key={log.eventId} className="rounded-lg border border-border bg-surface-alt/40 p-2.5 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-ink flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-brand" />
                    {log.action}
                  </span>
                  <span className="text-[11px] font-mono text-ink-muted">
                    {log.timestamp.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <div className="text-ink-muted">
                  Actor: {log.actorEmail} ({log.actorRole}) → Objetivo: {log.targetEmail || log.targetUid}
                </div>
                {log.reason && <div className="text-[11px] text-ink">Motivo: {log.reason}</div>}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};
