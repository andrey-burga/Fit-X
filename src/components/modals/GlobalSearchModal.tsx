import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { NavigationPath } from '../../types';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchItem {
  id: string;
  category: 'vista' | 'alimento' | 'ejercicio' | 'compras';
  title: string;
  subtitle: string;
  badge: string;
  icon: string;
  action: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const { navigate, openMealDrawer, groceries, mealLogs, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'vista' | 'alimento' | 'ejercicio' | 'compras'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Close on Escape, hotkey support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Build searchable index
  const searchableItems: SearchItem[] = useMemo(() => {
    const items: SearchItem[] = [
      // Views
      {
        id: 'v-1',
        category: 'vista',
        title: 'Dashboard Nutricional',
        subtitle: 'Resumen calórico, balances de macros y KPIs metabólicos diarios',
        badge: 'Vista',
        icon: 'analytics',
        action: () => {
          navigate('dashboard-nutricional');
          onClose();
        },
      },
      {
        id: 'v-2',
        category: 'vista',
        title: 'Configuración Nutricional',
        subtitle: 'BMR, TDEE, déficit calórico, fórmulas Mifflin-St Jeor y reparto',
        badge: 'Vista',
        icon: 'tune',
        action: () => {
          navigate('configuracion-nutricional');
          onClose();
        },
      },
      {
        id: 'v-3',
        category: 'vista',
        title: 'Menú Semanal Planificado',
        subtitle: 'Planificación de 7 días, momentos de comida y correspondencia con despensa',
        badge: 'Vista',
        icon: 'calendar_view_week',
        action: () => {
          navigate('menu-semanal');
          onClose();
        },
      },
      {
        id: 'v-4',
        category: 'vista',
        title: 'Registro de Comidas',
        subtitle: 'Historial granular, filtros por momento, duplicar registros y exportación CSV',
        badge: 'Vista',
        icon: 'restaurant',
        action: () => {
          navigate('registro-de-comidas');
          onClose();
        },
      },
      {
        id: 'v-5',
        category: 'vista',
        title: 'Registro Diario (Protocolo 180 días)',
        subtitle: 'Línea de tiempo, auditoría de adherencia, calidad de datos y SQL audit',
        badge: 'Vista',
        icon: 'edit_calendar',
        action: () => {
          navigate('registro-diario');
          onClose();
        },
      },
      {
        id: 'v-6',
        category: 'vista',
        title: 'Lista de Compras Semanal',
        subtitle: 'Insumos categorizados por departamentos: Carnes, Huevos, Verduras, Grasas',
        badge: 'Vista',
        icon: 'shopping_cart',
        action: () => {
          navigate('lista-de-compras');
          onClose();
        },
      },
      {
        id: 'v-7',
        category: 'vista',
        title: 'Sustituciones Alimentarias',
        subtitle: 'Matriz bidireccional isocalórica y calculadora dinámica de equivalencias',
        badge: 'Vista',
        icon: 'swap_horiz',
        action: () => {
          navigate('sustituciones');
          onClose();
        },
      },
      {
        id: 'v-8',
        category: 'vista',
        title: 'Guía y Ajustes Clínicos',
        subtitle: 'Directrices del protocolo, reglas de cálculo y compendio metodológico',
        badge: 'Vista',
        icon: 'menu_book',
        action: () => {
          navigate('guia-y-ajustes');
          onClose();
        },
      },
      {
        id: 'v-9',
        category: 'vista',
        title: 'Rutina de Entrenamiento',
        subtitle: 'Microciclo de 4 días, volumen semanal, RIR y reglas maestras de sobrecarga',
        badge: 'Vista',
        icon: 'fitness_center',
        action: () => {
          navigate('rutina-de-entrenamiento');
          onClose();
        },
      },
      {
        id: 'v-10',
        category: 'vista',
        title: 'Registro de Entrenamiento (Gym Mode)',
        subtitle: 'Temporizador de descanso, steppers de kg/reps, cálculo 1RM en vivo',
        badge: 'Vista',
        icon: 'format_list_bulleted',
        action: () => {
          navigate('registro-de-entrenamiento');
          onClose();
        },
      },
      {
        id: 'v-11',
        category: 'vista',
        title: 'Cardio y HIIT',
        subtitle: 'Polar H10 / Apple Watch, Zona 2 metabólica, ratio mTOR vs AMPK',
        badge: 'Vista',
        icon: 'directions_run',
        action: () => {
          navigate('cardio-y-hiit');
          onClose();
        },
      },
      {
        id: 'v-12',
        category: 'vista',
        title: 'Progreso del Entrenamiento',
        subtitle: 'Gráficos de 1RM, evolución por levantamiento, microciclo y récords',
        badge: 'Vista',
        icon: 'trending_up',
        action: () => {
          navigate('progreso-del-entrenamiento');
          onClose();
        },
      },

      // Exercises
      {
        id: 'ex-1',
        category: 'ejercicio',
        title: 'Press de Banca Plano con Barra',
        subtitle: 'Pecho / Empuje · 3 series efectivas @ RIR 1-2 · Récord: 85.0 kg x 8',
        badge: 'Ejercicio',
        icon: 'fitness_center',
        action: () => {
          navigate('registro-de-entrenamiento');
          onClose();
        },
      },
      {
        id: 'ex-2',
        category: 'ejercicio',
        title: 'Sentadilla Trasera con Barra',
        subtitle: 'Cuádriceps / Cadena · 3 series efectivas @ RIR 1 · Récord: 110.0 kg x 7',
        badge: 'Ejercicio',
        icon: 'fitness_center',
        action: () => {
          navigate('rutina-de-entrenamiento');
          onClose();
        },
      },
      {
        id: 'ex-3',
        category: 'ejercicio',
        title: 'Peso Muerto Convencional',
        subtitle: 'Cadena Posterior · 2 series efectivas @ RIR 1 · Récord: 130.0 kg x 6',
        badge: 'Ejercicio',
        icon: 'fitness_center',
        action: () => {
          navigate('progreso-del-entrenamiento');
          onClose();
        },
      },
      {
        id: 'ex-4',
        category: 'ejercicio',
        title: 'Remo con Barra Pendlay',
        subtitle: 'Espalda / Tracción · 3 series efectivas @ RIR 2 · Récord: 75.0 kg x 8',
        badge: 'Ejercicio',
        icon: 'fitness_center',
        action: () => {
          navigate('progreso-del-entrenamiento');
          onClose();
        },
      },
      {
        id: 'ex-5',
        category: 'ejercicio',
        title: 'Remo en Polea Baja / Jalón al Pecho',
        subtitle: 'Dorsal Ancho · 3 series @ RIR 1 · Tempo 3-0-1-1',
        badge: 'Ejercicio',
        icon: 'fitness_center',
        action: () => {
          navigate('rutina-de-entrenamiento');
          onClose();
        },
      },
      {
        id: 'ex-6',
        category: 'ejercicio',
        title: 'Protocolo Zona 2 (Bicicleta Estática)',
        subtitle: '45 minutos continuos a 130-138 ppm · Oxidación lipídica mitocondrial',
        badge: 'Cardio',
        icon: 'directions_bike',
        action: () => {
          navigate('cardio-y-hiit');
          onClose();
        },
      },

      // Food database & Recipes
      {
        id: 'food-1',
        category: 'alimento',
        title: 'Pechuga de Pollo a la Plancha',
        subtitle: '150 g · 248 kcal · 46.5g Proteína · 0g Carbs · 5.4g Grasa',
        badge: 'Alimento',
        icon: 'restaurant',
        action: () => {
          openMealDrawer();
          onClose();
        },
      },
      {
        id: 'food-2',
        category: 'alimento',
        title: 'Salmón del Atlántico Fresco',
        subtitle: '150 g · 312 kcal · 34.2g Proteína · 0g Carbs · 18.5g Grasa (Omega 3)',
        badge: 'Alimento',
        icon: 'restaurant',
        action: () => {
          navigate('sustituciones');
          onClose();
        },
      },
      {
        id: 'food-3',
        category: 'alimento',
        title: 'Avena en Hojuelas Integral',
        subtitle: '60 g · 228 kcal · 7.8g Proteína · 40.2g Carbs · 4.2g Grasa · 6g Fibra',
        badge: 'Alimento',
        icon: 'restaurant',
        action: () => {
          navigate('sustituciones');
          onClose();
        },
      },
      {
        id: 'food-4',
        category: 'alimento',
        title: 'Huevos Enteros Pasteurisados (3 uds)',
        subtitle: '165 g · 215 kcal · 18.9g Proteína · 1.5g Carbs · 14.8g Grasa',
        badge: 'Alimento',
        icon: 'egg',
        action: () => {
          openMealDrawer();
          onClose();
        },
      },
      {
        id: 'food-5',
        category: 'alimento',
        title: 'Aceite de Oliva Virgen Extra (AOVE)',
        subtitle: '15 ml · 124 kcal · 0g Proteína · 0g Carbs · 14.0g Ácido Oleico',
        badge: 'Alimento',
        icon: 'opacity',
        action: () => {
          navigate('sustituciones');
          onClose();
        },
      },
      {
        id: 'food-6',
        category: 'alimento',
        title: 'Batata / Camote Horneado',
        subtitle: '200 g · 172 kcal · 3.2g Proteína · 40.2g Carbs · 0.2g Grasa · Bajo IG',
        badge: 'Alimento',
        icon: 'restaurant',
        action: () => {
          navigate('sustituciones');
          onClose();
        },
      },
    ];

    // Add Groceries
    groceries.forEach(g => {
      items.push({
        id: `groc-${g.id}`,
        category: 'compras',
        title: g.name,
        subtitle: `Cantidad: ${g.quantity} ${g.unit} · Depto: ${g.department} · Estado: ${
          g.status === 'completed' ? 'Comprado' : 'Pendiente'
        }`,
        badge: 'Compras',
        icon: 'shopping_bag',
        action: () => {
          navigate('lista-de-compras');
          onClose();
        },
      });
    });

    // Add Meal Logs
    mealLogs.forEach(m => {
      items.push({
        id: `mlog-${m.id}`,
        category: 'alimento',
        title: m.title,
        subtitle: `${m.moment.toUpperCase()} · ${m.portion} · ${m.calories} kcal · P: ${m.protein}g C: ${m.carbs}g G: ${m.fats}g`,
        badge: 'Registro',
        icon: 'receipt_long',
        action: () => {
          navigate('registro-de-comidas');
          onClose();
        },
      });
    });

    return items;
  }, [groceries, mealLogs, navigate, openMealDrawer, onClose]);

  // Filter items
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return searchableItems.filter(item => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q)
      );
    });
  }, [searchableItems, query, selectedCategory]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-inverse-surface/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Search dialog */}
      <div
        className="relative w-full max-w-2xl bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container overflow-hidden z-10 flex flex-col max-h-[80vh]"
        onKeyDown={handleKeyDown}
      >
        {/* Input bar */}
        <div className="p-4 border-b border-surface-container flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-2xl">search</span>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar vistas, alimentos, ejercicios, compras o registros..."
            className="w-full bg-transparent text-base text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-on-surface-variant hover:bg-surface-container text-xs"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-surface-container-low text-[11px] font-mono text-on-surface-variant border border-surface-container">
            ESC
          </span>
        </div>

        {/* Filter Pills */}
        <div className="px-4 py-2 bg-surface-container-low flex gap-1.5 overflow-x-auto border-b border-surface-container/40 no-scrollbar">
          {[
            { id: 'all', label: 'Todo' },
            { id: 'vista', label: 'Vistas del Sistema' },
            { id: 'alimento', label: 'Nutrición y Comidas' },
            { id: 'ejercicio', label: 'Ejercicios y Gym' },
            { id: 'compras', label: 'Lista de Compras' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id as any)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-surface-container/30">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-3xl mb-2 opacity-50">search_off</span>
              <p className="text-sm font-semibold text-on-surface">No se encontraron resultados para &ldquo;{query}&rdquo;</p>
              <p className="text-xs mt-1">Prueba con palabras como &ldquo;pollo&rdquo;, &ldquo;banca&rdquo;, &ldquo;compras&rdquo; o &ldquo;bmr&rdquo;.</p>
            </div>
          ) : (
            filtered.slice(0, 40).map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`p-3 rounded-xl cursor-pointer flex items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-surface-container' : 'hover:bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      <span className="material-symbols-outlined text-lg">{item.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-on-surface truncate">
                          {item.title}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface-variant uppercase tracking-wider shrink-0">
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                        {item.subtitle}
                      </p>
                    </div>
                  </div>

                  <span className="material-symbols-outlined text-sm text-on-surface-variant shrink-0">
                    arrow_forward
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="p-2.5 px-4 bg-surface-container-low border-t border-surface-container/40 flex items-center justify-between text-[11px] text-on-surface-variant">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-surface-container rounded border border-surface-container-high">↑</kbd>{' '}
              <kbd className="px-1 py-0.5 bg-surface-container rounded border border-surface-container-high">↓</kbd>{' '}
              Navegar
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-surface-container-high">Enter</kbd>{' '}
              Abrir
            </span>
          </div>
          <span>{filtered.length} resultados en tiempo real</span>
        </div>
      </div>
    </div>
  );
};
