/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — AdminUsersView (Increment 7D)
 * Enterprise-grade SaaS Administrative Console for User Management, RBAC,
 * Invitations, Account Suspension, and Append-Only Audit Logging.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  AdminUserSummary,
  AdminPlatformStats,
  AdminUserDirectoryFilter,
  UserRole,
  AccountAccessStatus,
  AdminAuditLog,
} from '../types/admin';
import {
  fetchAdminUserDirectory,
  fetchAdminUserDetail,
  createInvitation,
  revokeInvitation,
  updateUserRole,
  updateUserStatus,
  requestUserPasswordReset,
  fetchAuditLogs,
} from '../services/adminUserService';

export const AdminUsersView: React.FC = () => {
  const { currentUserRole, currentUser, showToast } = useApp();

  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [stats, setStats] = useState<AdminPlatformStats>({
    totalUsers: 0,
    activeUsers: 0,
    suspendedUsers: 0,
    pendingVerificationUsers: 0,
    pendingInvitations: 0,
    recentSignups30d: 0,
  });
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<UserRole | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<AccountAccessStatus | 'all'>('all');
  const [selectedVerified, setSelectedVerified] = useState<boolean | 'all'>('all');
  const [page, setPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<'createdAt' | 'lastSignInAt' | 'displayName' | 'email'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Modals & Panels
  const [selectedUserUid, setSelectedUserUid] = useState<string | null>(null);
  const [detailUser, setDetailUser] = useState<AdminUserSummary | null>(null);
  const [detailLogs, setDetailLogs] = useState<AdminAuditLog[]>([]);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState<boolean>(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState<boolean>(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState<boolean>(false);
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  // Action Form States
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<'athlete' | 'admin'>('athlete');
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState<string>('');
  const [newTargetRole, setNewTargetRole] = useState<UserRole>('athlete');
  const [isActionSubmitting, setIsActionSubmitting] = useState<boolean>(false);

  const isSuperadmin = currentUserRole === 'superadmin';

  // Load Directory
  const loadDirectory = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminUserDirectory({
        searchQuery,
        role: selectedRole,
        accountStatus: selectedStatus,
        emailVerified: selectedVerified,
        page,
        pageSize: 15,
        sortBy,
        sortOrder,
      });
      setUsers(res.users);
      setStats(res.stats);
      setTotalPages(res.totalPages);
      setTotalCount(res.totalCount);
    } catch (err: any) {
      showToast(err.message || 'Error al cargar directorio de usuarios', 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory();
  }, [searchQuery, selectedRole, selectedStatus, selectedVerified, page, sortBy, sortOrder]);

  // Open User Detail
  const handleOpenDetail = async (uid: string) => {
    setSelectedUserUid(uid);
    setIsDetailDrawerOpen(true);
    try {
      const res = await fetchAdminUserDetail(uid);
      setDetailUser(res.user);
      setDetailLogs(res.recentLogs);
    } catch (err: any) {
      showToast(err.message || 'Error al cargar detalles del usuario', 'warning');
    }
  };

  // Handle Invitation Creation
  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      showToast('Por favor ingrese un correo electrónico válido', 'warning');
      return;
    }
    setIsActionSubmitting(true);
    try {
      const res = await createInvitation(inviteEmail, inviteRole);
      setGeneratedInviteLink(res.inviteLink);
      showToast('Invitación creada exitosamente.', 'success');
      loadDirectory();
    } catch (err: any) {
      showToast(err.message || 'Error al crear invitación', 'warning');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  // Handle Account Suspension / Reactivation
  const handleToggleAccountStatus = async () => {
    if (!detailUser) return;
    const targetStatus = detailUser.accountStatus === 'suspended' ? 'active' : 'suspended';
    setIsActionSubmitting(true);
    try {
      await updateUserStatus(detailUser.uid, targetStatus, actionReason);
      showToast(
        targetStatus === 'suspended' ? 'Cuenta suspendida exitosamente.' : 'Cuenta reactivada exitosamente.',
        'success'
      );
      setIsStatusModalOpen(false);
      setActionReason('');
      await loadDirectory();
      handleOpenDetail(detailUser.uid);
    } catch (err: any) {
      showToast(err.message || 'Error al modificar estado de la cuenta', 'warning');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  // Handle Role Change
  const handleChangeRole = async () => {
    if (!detailUser) return;
    setIsActionSubmitting(true);
    try {
      await updateUserRole(detailUser.uid, newTargetRole, actionReason);
      showToast(`Rol actualizado a [${newTargetRole}] exitosamente.`, 'success');
      setIsRoleModalOpen(false);
      setActionReason('');
      await loadDirectory();
      handleOpenDetail(detailUser.uid);
    } catch (err: any) {
      showToast(err.message || 'Error al cambiar rol del usuario', 'warning');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  // Handle Password Reset Request
  const handlePasswordReset = async (uid: string) => {
    try {
      const res = await requestUserPasswordReset(uid);
      showToast(`Enlace de restablecimiento enviado a ${res.emailSentTo}.`, 'info');
    } catch (err: any) {
      showToast(err.message || 'Error al solicitar recuperación de contraseña', 'warning');
    }
  };

  // Load Audit Trail
  const handleOpenAuditLogs = async () => {
    setIsAuditDrawerOpen(true);
    try {
      const res = await fetchAuditLogs({ pageSize: 50 });
      setAuditLogs(res.logs);
    } catch (err: any) {
      showToast(err.message || 'Error al consultar logs de auditoría', 'warning');
    }
  };

  return (
    <div className="p-space-lg max-w-7xl mx-auto flex flex-col gap-space-lg text-on-surface">
      {/* 1. Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md border-b border-surface-container pb-space-md">
        <div>
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-2xl">manage_accounts</span>
            <h1 className="font-headline-md text-headline-md font-bold tracking-tight">
              Gestión de Usuarios
            </h1>
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold uppercase bg-primary-fixed text-on-primary-fixed">
              {currentUserRole}
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Control de identidades, perfiles RBAC, invitaciones criptográficas y auditoría de accesos.
          </p>
        </div>

        <div className="flex items-center gap-space-sm w-full sm:w-auto">
          <button
            onClick={handleOpenAuditLogs}
            className="flex-1 sm:flex-none px-space-md py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-medium text-body-sm flex items-center justify-center gap-1.5 transition-colors border border-surface-container-highest"
          >
            <span className="material-symbols-outlined text-lg">history</span>
            Auditoría
          </button>
          <button
            onClick={() => {
              setGeneratedInviteLink(null);
              setInviteEmail('');
              setInviteRole('athlete');
              setIsInviteModalOpen(true);
            }}
            className="flex-1 sm:flex-none px-space-md py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-medium text-body-sm flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-lg">person_add</span>
            Invitar Usuario
          </button>
        </div>
      </div>

      {/* 2. Platform KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-space-sm">
        <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col">
          <span className="text-label-sm text-on-surface-variant font-medium">Total Usuarios</span>
          <span className="text-2xl font-bold mt-1 text-on-surface">{stats.totalUsers}</span>
          <span className="text-[11px] text-on-surface-variant/80 mt-1">Directorio global</span>
        </div>
        <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col">
          <span className="text-label-sm text-on-surface-variant font-medium">Activos</span>
          <span className="text-2xl font-bold mt-1 text-emerald-500">{stats.activeUsers}</span>
          <span className="text-[11px] text-emerald-600/80 mt-1">Acceso pleno</span>
        </div>
        <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col">
          <span className="text-label-sm text-on-surface-variant font-medium">Suspendidos</span>
          <span className="text-2xl font-bold mt-1 text-rose-500">{stats.suspendedUsers}</span>
          <span className="text-[11px] text-rose-600/80 mt-1">Acceso revocado</span>
        </div>
        <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col">
          <span className="text-label-sm text-on-surface-variant font-medium">Sin Verificar</span>
          <span className="text-2xl font-bold mt-1 text-amber-500">{stats.pendingVerificationUsers}</span>
          <span className="text-[11px] text-amber-600/80 mt-1">Correo pendiente</span>
        </div>
        <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col">
          <span className="text-label-sm text-on-surface-variant font-medium">Invitaciones</span>
          <span className="text-2xl font-bold mt-1 text-primary">{stats.pendingInvitations}</span>
          <span className="text-[11px] text-primary/80 mt-1">Por canjear</span>
        </div>
        <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col">
          <span className="text-label-sm text-on-surface-variant font-medium">Nuevos (30d)</span>
          <span className="text-2xl font-bold mt-1 text-sky-500">{stats.recentSignups30d}</span>
          <span className="text-[11px] text-sky-600/80 mt-1">Último mes</span>
        </div>
      </div>

      {/* 3. Search and Filters Bar */}
      <div className="p-space-md bg-surface-container-low rounded-xl border border-surface-container flex flex-col md:flex-row gap-space-sm items-center justify-between">
        <div className="relative w-full md:w-96">
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-lg">
            search
          </span>
          <input
            type="text"
            placeholder="Buscar por UID, correo o nombre..."
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface placeholder:text-on-surface-variant/60 border border-transparent focus:border-primary focus:outline-hidden"
          />
        </div>

        <div className="flex flex-wrap items-center gap-space-xs w-full md:w-auto">
          {/* Role Filter */}
          <select
            value={selectedRole}
            onChange={e => {
              setSelectedRole(e.target.value as any);
              setPage(1);
            }}
            className="px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
          >
            <option value="all">Todos los Roles</option>
            <option value="athlete">Atletas</option>
            <option value="admin">Administradores</option>
            <option value="superadmin">Superadministradores</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={e => {
              setSelectedStatus(e.target.value as any);
              setPage(1);
            }}
            className="px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
          >
            <option value="all">Todos los Estados</option>
            <option value="active">Activos</option>
            <option value="suspended">Suspendidos</option>
            <option value="pending_verification">Sin Verificar</option>
          </select>

          {/* Email Verified Filter */}
          <select
            value={String(selectedVerified)}
            onChange={e => {
              const val = e.target.value;
              setSelectedVerified(val === 'all' ? 'all' : val === 'true');
              setPage(1);
            }}
            className="px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
          >
            <option value="all">Verificación Email (Todos)</option>
            <option value="true">Verificado</option>
            <option value="false">No Verificado</option>
          </select>

          {/* Refresh button */}
          <button
            onClick={loadDirectory}
            className="p-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant transition-colors"
            title="Recargar directorio"
          >
            <span className="material-symbols-outlined text-lg">refresh</span>
          </button>
        </div>
      </div>

      {/* 4. Users Table */}
      <div className="bg-surface-container-low rounded-xl border border-surface-container overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container/50 text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">Correo</th>
                <th className="py-3 px-4">Rol</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Verificado</th>
                <th className="py-3 px-4">Registro</th>
                <th className="py-3 px-4">Último Acceso</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container text-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-on-surface-variant">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span>Cargando directorio seguro de usuarios...</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-on-surface-variant">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">
                      group_off
                    </span>
                    <p className="font-medium">No se encontraron usuarios con los filtros especificados.</p>
                  </td>
                </tr>
              ) : (
                users.map(u => {
                  const isCurrentLoggedUser = u.uid === currentUser?.id;
                  return (
                    <tr
                      key={u.uid}
                      className="hover:bg-surface-container/40 transition-colors cursor-pointer"
                      onClick={() => handleOpenDetail(u.uid)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt={u.displayName}
                              className="w-8 h-8 rounded-full object-cover ring-1 ring-surface-container-highest"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-bold text-xs">
                              {u.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="font-semibold text-on-surface flex items-center gap-1.5">
                              {u.displayName}
                              {isCurrentLoggedUser && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.2 rounded-full font-medium">
                                  Tú
                                </span>
                              )}
                            </span>
                            <span className="text-[11px] text-on-surface-variant font-mono">
                              {u.uid.substring(0, 12)}...
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-on-surface font-mono text-xs">{u.email}</td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            u.role === 'superadmin'
                              ? 'bg-purple-100 text-purple-900 border border-purple-300 dark:bg-purple-900/40 dark:text-purple-300'
                              : u.role === 'admin'
                              ? 'bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                            u.accountStatus === 'suspended'
                              ? 'bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-900/40 dark:text-rose-300'
                              : u.accountStatus === 'pending_verification'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.accountStatus === 'suspended'
                                ? 'bg-rose-500'
                                : u.accountStatus === 'pending_verification'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                          />
                          {u.accountStatus === 'suspended'
                            ? 'Suspendida'
                            : u.accountStatus === 'pending_verification'
                            ? 'Pendiente'
                            : 'Activa'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {u.emailVerified ? (
                          <span className="material-symbols-outlined text-emerald-500 text-lg" title="Verificado">
                            verified
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-amber-500 text-lg" title="No verificado">
                            schedule
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs text-on-surface-variant">
                        {new Date(u.createdAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>

                      <td className="py-3 px-4 text-xs text-on-surface-variant">
                        {u.lastSignInAt
                          ? new Date(u.lastSignInAt).toLocaleDateString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Nunca'}
                      </td>

                      <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenDetail(u.uid)}
                            className="p-1 rounded-md text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                            title="Ver detalles"
                          >
                            <span className="material-symbols-outlined text-lg">visibility</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="py-3 px-4 bg-surface-container/30 border-t border-surface-container flex items-center justify-between text-body-sm text-on-surface-variant">
          <span>
            Mostrando {users.length} de {totalCount} usuarios
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface disabled:opacity-40 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <span className="px-2 text-xs font-semibold">
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface disabled:opacity-40 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* 5. User Detail Slide-Over Drawer */}
      {isDetailDrawerOpen && detailUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs transition-opacity"
            onClick={() => setIsDetailDrawerOpen(false)}
          />
          <div className="relative w-full max-w-lg bg-surface-container-lowest h-full shadow-2xl z-10 flex flex-col overflow-y-auto border-l border-surface-container">
            <div className="p-space-lg border-b border-surface-container flex items-center justify-between sticky top-0 bg-surface-container-lowest/90 backdrop-blur-sm z-10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">account_circle</span>
                <h2 className="font-headline-sm text-headline-sm font-bold">Detalle de Usuario</h2>
              </div>
              <button
                onClick={() => setIsDetailDrawerOpen(false)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-space-lg flex flex-col gap-space-lg flex-1">
              {/* Profile Card */}
              <div className="p-space-md bg-surface-container-low rounded-xl border border-surface-container flex items-center gap-3">
                {detailUser.avatarUrl ? (
                  <img
                    src={detailUser.avatarUrl}
                    alt={detailUser.displayName}
                    className="w-14 h-14 rounded-full object-cover ring-2 ring-primary"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-bold text-xl">
                    {detailUser.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="text-lg font-bold text-on-surface">{detailUser.displayName}</span>
                  <span className="text-xs text-on-surface-variant font-mono">{detailUser.email}</span>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        detailUser.role === 'superadmin'
                          ? 'bg-purple-100 text-purple-900 border border-purple-300'
                          : detailUser.role === 'admin'
                          ? 'bg-indigo-100 text-indigo-900 border border-indigo-300'
                          : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      }`}
                    >
                      {detailUser.role}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        detailUser.accountStatus === 'suspended'
                          ? 'bg-rose-100 text-rose-900 border border-rose-300'
                          : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      }`}
                    >
                      {detailUser.accountStatus}
                    </span>
                  </div>
                </div>
              </div>

              {/* Technical Identifiers */}
              <div className="flex flex-col gap-space-xs text-body-sm">
                <span className="text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
                  Metadatos de Autenticación
                </span>
                <div className="p-space-sm bg-surface-container-low rounded-lg border border-surface-container flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">UID:</span>
                    <span className="font-mono text-on-surface">{detailUser.uid}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Proveedor Auth:</span>
                    <span className="font-medium text-on-surface">{detailUser.authProvider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Email Verificado:</span>
                    <span className={detailUser.emailVerified ? 'text-emerald-500 font-semibold' : 'text-amber-500 font-semibold'}>
                      {detailUser.emailVerified ? 'SÍ' : 'NO'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Fecha de Registro:</span>
                    <span className="text-on-surface">{new Date(detailUser.createdAt).toLocaleString('es-ES')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Último Acceso:</span>
                    <span className="text-on-surface">
                      {detailUser.lastSignInAt ? new Date(detailUser.lastSignInAt).toLocaleString('es-ES') : 'Sin registros'}
                    </span>
                  </div>
                  {detailUser.accountStatus === 'suspended' && (
                    <div className="mt-2 pt-2 border-t border-rose-200 dark:border-rose-900/50 flex flex-col gap-1 text-rose-600">
                      <span className="font-semibold">Información de Suspensión:</span>
                      <span>Motivo: {detailUser.suspensionReason || 'No especificado'}</span>
                      <span>Fecha: {detailUser.suspendedAt ? new Date(detailUser.suspendedAt).toLocaleString('es-ES') : 'Desconocida'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Administrative Actions */}
              <div className="flex flex-col gap-space-xs">
                <span className="text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
                  Acciones Administrativas
                </span>
                <div className="grid grid-cols-1 gap-2">
                  {/* Superadmin: Change Role */}
                  {isSuperadmin && (
                    <button
                      onClick={() => {
                        setNewTargetRole(detailUser.role);
                        setIsRoleModalOpen(true);
                      }}
                      className="w-full py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-medium text-body-sm flex items-center justify-between border border-surface-container-highest transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">badge</span>
                        Modificar Rol de Usuario
                      </span>
                      <span className="text-xs text-on-surface-variant">Superadmin</span>
                    </button>
                  )}

                  {/* Suspend or Reactivate */}
                  <button
                    onClick={() => {
                      setActionReason('');
                      setIsStatusModalOpen(true);
                    }}
                    disabled={detailUser.uid === currentUser?.id}
                    className={`w-full py-2 px-3 rounded-lg font-medium text-body-sm flex items-center justify-between border transition-colors disabled:opacity-50 ${
                      detailUser.accountStatus === 'suspended'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
                        : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined">
                        {detailUser.accountStatus === 'suspended' ? 'lock_open' : 'block'}
                      </span>
                      {detailUser.accountStatus === 'suspended' ? 'Reactivar Cuenta' : 'Suspender Cuenta'}
                    </span>
                    {detailUser.uid === currentUser?.id && (
                      <span className="text-xs">No permitido (Tu cuenta)</span>
                    )}
                  </button>

                  {/* Password Reset */}
                  <button
                    onClick={() => handlePasswordReset(detailUser.uid)}
                    className="w-full py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-medium text-body-sm flex items-center justify-between border border-surface-container-highest transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-amber-500">lock_reset</span>
                      Solicitar Restablecimiento de Contraseña
                    </span>
                    <span className="text-xs text-on-surface-variant">Email</span>
                  </button>
                </div>
              </div>

              {/* User Specific Audit History */}
              <div className="flex flex-col gap-space-xs flex-1">
                <span className="text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
                  Historial de Auditoría Reciente
                </span>
                <div className="p-space-sm bg-surface-container-low rounded-lg border border-surface-container flex flex-col gap-2 max-h-56 overflow-y-auto">
                  {detailLogs.length === 0 ? (
                    <span className="text-xs text-on-surface-variant/80 italic text-center py-2">
                      No hay registros de auditoría previos para esta cuenta.
                    </span>
                  ) : (
                    detailLogs.map(log => (
                      <div key={log.eventId} className="flex flex-col gap-0.5 text-xs pb-1.5 border-b border-surface-container last:border-b-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-primary">{log.action}</span>
                          <span className="text-[10px] text-on-surface-variant">
                            {new Date(log.timestamp).toLocaleString('es-ES')}
                          </span>
                        </div>
                        {log.reason && <span className="text-on-surface-variant">{log.reason}</span>}
                        <span className="text-[10px] text-on-surface-variant/70 font-mono">
                          Actor: {log.actorEmail || log.actorUid} ({log.actorRole})
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Invite Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs"
            onClick={() => setIsInviteModalOpen(false)}
          />
          <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl p-space-lg shadow-xl z-10 border border-surface-container">
            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">person_add</span>
              Invitar Nuevo Usuario
            </h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Se generará un token criptográfico seguro (SHA-256) válido por 7 días.
            </p>

            {generatedInviteLink ? (
              <div className="mt-4 flex flex-col gap-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300">
                  <span className="font-bold block mb-1">¡Invitación generada con éxito!</span>
                  Copia el enlace seguro a continuación y compártelo directamente con el usuario:
                </div>
                <div className="p-2.5 bg-surface-container rounded-lg font-mono text-xs break-all border border-surface-container-highest select-all">
                  {generatedInviteLink}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedInviteLink);
                    showToast('Enlace copiado al portapapeles', 'success');
                  }}
                  className="w-full py-2 rounded-lg bg-primary text-on-primary font-medium text-body-sm flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  Copiar Enlace al Portapapeles
                </button>
                <button
                  onClick={() => setIsInviteModalOpen(false)}
                  className="w-full py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-body-sm"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateInvitation} className="mt-4 flex flex-col gap-space-md">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                    Correo Electrónico del Destinatario
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="atleta@vigorcore.com"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                    Rol a Asignar
                  </label>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
                  >
                    <option value="athlete">Atleta (Acceso ordinario)</option>
                    {isSuperadmin && <option value="admin">Administrador (Gestión de usuarios)</option>}
                  </select>
                  {!isSuperadmin && (
                    <span className="text-[11px] text-on-surface-variant mt-1 block">
                      Nota: Solo superadministradores pueden invitar nuevos administradores.
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-3 py-2 rounded-lg bg-surface-container text-on-surface text-body-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isActionSubmitting}
                    className="px-4 py-2 rounded-lg bg-primary text-on-primary font-medium text-body-sm disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isActionSubmitting ? 'Generando...' : 'Generar Invitación'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 7. Suspend / Reactivate Modal */}
      {isStatusModalOpen && detailUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs"
            onClick={() => setIsStatusModalOpen(false)}
          />
          <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl p-space-lg shadow-xl z-10 border border-surface-container">
            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-500">warning</span>
              {detailUser.accountStatus === 'suspended' ? 'Confirmar Reactivación' : 'Confirmar Suspensión'}
            </h3>
            <p className="text-xs text-on-surface-variant mt-1">
              {detailUser.accountStatus === 'suspended'
                ? `La cuenta de ${detailUser.displayName} será rehabilitada y podrá volver a iniciar sesión.`
                : `La cuenta de ${detailUser.displayName} será deshabilitada en Firebase Auth, sus sesiones serán revocadas y sus permisos de Firestore quedarán bloqueados inmediatamente.`}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Motivo de la acción (requerido para trazabilidad de auditoría)
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Escriba el motivo administrativo..."
                  value={actionReason}
                  onChange={e => setActionReason(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsStatusModalOpen(false)}
                  className="px-3 py-2 rounded-lg bg-surface-container text-on-surface text-body-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleToggleAccountStatus}
                  disabled={isActionSubmitting || !actionReason.trim()}
                  className={`px-4 py-2 rounded-lg font-medium text-body-sm text-white disabled:opacity-50 ${
                    detailUser.accountStatus === 'suspended' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isActionSubmitting ? 'Procesando...' : 'Confirmar Acción'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. Change Role Modal (Superadmin Only) */}
      {isRoleModalOpen && detailUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs"
            onClick={() => setIsRoleModalOpen(false)}
          />
          <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl p-space-lg shadow-xl z-10 border border-surface-container">
            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">badge</span>
              Modificar Rol de Usuario
            </h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Esta acción actualizará los Custom Claims en Firebase Authentication y se reflejará en la sesión del usuario.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Nuevo Rol
                </label>
                <select
                  value={newTargetRole}
                  onChange={e => setNewTargetRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
                >
                  <option value="athlete">athlete (Atleta ordinario)</option>
                  <option value="admin">admin (Personal administrativo)</option>
                  <option value="superadmin">superadmin (Acceso total)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Justificación administrativa
                </label>
                <input
                  type="text"
                  placeholder="Motivo del cambio de rol..."
                  value={actionReason}
                  onChange={e => setActionReason(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-container rounded-lg text-body-sm text-on-surface border border-transparent focus:border-primary focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsRoleModalOpen(false)}
                  className="px-3 py-2 rounded-lg bg-surface-container text-on-surface text-body-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleChangeRole}
                  disabled={isActionSubmitting || newTargetRole === detailUser.role}
                  className="px-4 py-2 rounded-lg bg-primary text-on-primary font-medium text-body-sm disabled:opacity-50"
                >
                  {isActionSubmitting ? 'Guardando...' : 'Aplicar Rol'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. Full System Audit Logs Drawer */}
      {isAuditDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs transition-opacity"
            onClick={() => setIsAuditDrawerOpen(false)}
          />
          <div className="relative w-full max-w-2xl bg-surface-container-lowest h-full shadow-2xl z-10 flex flex-col overflow-y-auto border-l border-surface-container">
            <div className="p-space-lg border-b border-surface-container flex items-center justify-between sticky top-0 bg-surface-container-lowest/90 backdrop-blur-sm z-10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">history</span>
                <h2 className="font-headline-sm text-headline-sm font-bold">Registro de Auditoría Append-Only</h2>
              </div>
              <button
                onClick={() => setIsAuditDrawerOpen(false)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-space-lg flex flex-col gap-space-md flex-1">
              <p className="text-xs text-on-surface-variant">
                Colección inmutable `adminAuditLogs`. Cada evento administrativo sensible queda sellado con UID del actor, timestamp de servidor y parámetros.
              </p>

              <div className="flex flex-col gap-2">
                {auditLogs.length === 0 ? (
                  <div className="py-12 text-center text-on-surface-variant">
                    <span className="material-symbols-outlined text-4xl mb-2 text-on-surface-variant/40">
                      verified_user
                    </span>
                    <p className="font-medium">No se registran eventos de auditoría todavía.</p>
                  </div>
                ) : (
                  auditLogs.map(log => (
                    <div
                      key={log.eventId}
                      className="p-space-md bg-surface-container-low rounded-xl border border-surface-container flex flex-col gap-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary uppercase tracking-wider text-[11px]">
                          {log.action}
                        </span>
                        <span className="text-on-surface-variant font-mono">
                          {new Date(log.timestamp).toLocaleString('es-ES')}
                        </span>
                      </div>
                      {log.reason && <p className="text-on-surface mt-1">{log.reason}</p>}
                      <div className="mt-1 pt-1 border-t border-surface-container/60 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant font-mono">
                        <span>Actor: {log.actorEmail || log.actorUid} ({log.actorRole})</span>
                        {log.targetEmail && <span>Target: {log.targetEmail}</span>}
                        {log.targetUid && <span>UID: {log.targetUid}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
