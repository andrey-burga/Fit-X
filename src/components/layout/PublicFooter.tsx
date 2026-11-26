/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Reusable Public Footer Component
 * Displays consistent Spanish navigation links and the mandatory AWD S.A.S. copyright notice.
 */

import React from 'react';

interface PublicFooterProps {
  onNavigateSection: (sectionId: string) => void;
  onSignInAction: () => void;
  isAuthenticated: boolean;
}

export const PublicFooter: React.FC<PublicFooterProps> = ({
  onNavigateSection,
  onSignInAction,
  isAuthenticated,
}) => {
  return (
    <footer className="border-t border-outline-variant/50 bg-surface-container-lowest py-10">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <span className="font-landing-display font-bold text-base tracking-tight text-on-background block">
              VigorCore
            </span>
            <p className="text-xs text-on-surface-variant">
              Espacio privado de entrenamiento de fuerza y nutrición estructurada.
            </p>
          </div>

          <nav
            aria-label="Navegación de pie de página"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-on-surface-variant"
          >
            <button
              type="button"
              onClick={() => onNavigateSection('modulos')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Módulos
            </button>
            <button
              type="button"
              onClick={() => onNavigateSection('confianza')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Modelo de acceso
            </button>
            <button
              type="button"
              onClick={() => onNavigateSection('como-funciona')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Cómo funciona
            </button>
            <button
              type="button"
              onClick={onSignInAction}
              className="font-semibold text-primary hover:underline underline-offset-4 cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {isAuthenticated ? 'Abrir espacio privado' : 'Iniciar sesión'}
            </button>
          </nav>
        </div>

        <div className="pt-5 border-t border-outline-variant/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-on-surface-variant">
          <p className="font-medium text-on-background">
            © 2026 AWD S.A.S. — Todos los derechos reservados.
          </p>
          <p>
            El acceso a datos personales requiere autenticación previa.
          </p>
        </div>
      </div>
    </footer>
  );
};
