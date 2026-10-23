import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

interface SubstitutionCardData {
  id: string;
  category: 'proteina' | 'carbohidratos' | 'grasas' | 'lacteos' | 'vegetales';
  categoryLabel: string;
  rule: string;
  factor: string;
  original: {
    name: string;
    portionLabel: string;
    kcal: number;
    p: number;
    c: number;
    f: number;
    img: string;
  };
  substitute: {
    name: string;
    portionLabel: string;
    kcal: number;
    p: number;
    c: number;
    f: number;
    img: string;
  };
  deltaKcal: number;
  macroBalanceNote: string;
  proteinRatioPct: number;
  fatRatioPct: number;
  specialNote?: string;
  secondaryOption?: string;
  secondaryOptionKcal?: string;
}

const initialCards: SubstitutionCardData[] = [
  {
    id: 'sub-1',
    category: 'proteina',
    categoryLabel: 'Proteína Magra',
    rule: 'Regla: Isoproteico (Varianza calórica −3.0%)',
    factor: '1.10x',
    original: {
      name: 'Pechuga de Pollo',
      portionLabel: '100g en crudo',
      kcal: 165,
      p: 31,
      c: 0,
      f: 3.6,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDLqzejCyLZZB2gCPXwkNepMPvpbMhhKi3RaSjfE1cbfNdksV07H9ahD5us-jOIztvdDihNPeFdPhK9krHTsBWjdmAf5WGp_pWvPN6s9ISUD9cW0lpYJmWQ72I2YwKn8ew1ET7H5yTVUmbrAZILufWjP_zeGnFKZocJ3lBb2TY4dqbcnfh_Im8ptEvYGH3l4h8ZSToInVLDXtwJvWnVStYZlUztlpey-4lOE6uCzmDPfd0CgWSfaDO0QQ',
    },
    substitute: {
      name: 'Lomo de Pavo Fileteado',
      portionLabel: '110g (+10g)',
      kcal: 160,
      p: 31,
      c: 0,
      f: 2.8,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOs5FmzcdXeM45oNThRsH65x5u8n4sJCoOu8lm6IAA0UWJy0VFfaTsWkJ_YIRPcVP8Yqmo854k1adQeHbkaNlqoIqSkK_tJIj3MOJ_94s1IEbnOc5_S89sY_bGTuuqK3HHlnrQNb3tM9Eqh-45JKu4jXVramzAWeeg6WZNOy2okcpaj1ZQTKon8dd88SP0vK83ALmCB52PQYG8kSi6fPUjk52d0jikcg6-EHZ-xZDZYrQvBsGeolllvg',
    },
    deltaKcal: -5,
    macroBalanceNote: 'Equilibrio Macro: Proteína (100%) • Lípidos (−0.8g)',
    proteinRatioPct: 88,
    fatRatioPct: 12,
  },
  {
    id: 'sub-2',
    category: 'proteina',
    categoryLabel: 'Omega-3 & Pescado Graso',
    rule: 'Regla: Isocalórico / Isolipídico (Varianza +0.9%)',
    factor: '1.10x',
    original: {
      name: 'Salmón Fresco Salvaje',
      portionLabel: '150g en porción limpia',
      kcal: 312,
      p: 30,
      c: 0,
      f: 20,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuATWW3N8ucf-zefcwizl7Upnuy-OUSAMuXgjZiD6YqXXE8Qa4V-ise1FkYCdeaM877cH6znOsuR9kQQcoM9M_sdQud5SLaFO90TvcB7her7RqBeq7zHhh1Iqss66tI5yLM_cbhqg_Hw0SjLDDEko0p9ZSXe_IKju1tvMPIQZW-hNbI6w3RLndIVEhu5N95C1aT25BGbXVPUNK6cucffIi9VHJB_UcYBb3z95iufQyHHF35bzNNVmSE3xg',
    },
    substitute: {
      name: 'Trucha Arcoíris Fresca',
      portionLabel: '165g (+15g)',
      kcal: 315,
      p: 31,
      c: 0,
      f: 19,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD-KzGSRtImnYBR3xPfZj5FHGEwDzT5FCxmtGXsd5FfH84a6WctpiyZOCnELClFDG118M9GxlaL6gbcZGsuVpFrX9OoGI9UTSXuthTFE3CaBj3_EpNPMQ-l4ScGuKhAgwqf08C_UH_NbwFiunjA-Z0GcnOOykcCWzXokTuU29fbqcO5kGYi0ubn6il_YPesCIUFsfjyUw67gmDr-NwVgxgkcgt7lA5kWkQsa7kamItGsZ7AEvH1pKTqbg',
    },
    deltaKcal: 3,
    macroBalanceNote: 'Equilibrio Macro: Proteína (100%) • Lípidos (19g)',
    proteinRatioPct: 62,
    fatRatioPct: 38,
    secondaryOption: '140g Atún fresco en filete + 10ml AOVE',
    secondaryOptionKcal: '310 kcal (0.6% Δ)',
    specialNote: 'EPA + DHA: 2,150 mg bioequivalente',
  },
  {
    id: 'sub-3',
    category: 'carbohidratos',
    categoryLabel: 'Almidón Complejo / Digestión Rápida',
    rule: 'Regla: Isoglúcido (Carbos netos exactos: 40-41g)',
    factor: '0.86x',
    original: {
      name: 'Avena en Hojuelas',
      portionLabel: '60g en peso seco',
      kcal: 227,
      p: 8,
      c: 40,
      f: 4,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCS-Ft2U28VdoA1Kp3sEwvsQBszgBgjUOMSQdbBvlagoF4SvkqdNYBOKnhGzmOTnkjjBlV29lj6Y5HyBVIwQZjioe6iip90V1vsPz_ITs0kSvjThmsA1j2PDwPPqmMd1xY-w_1i3ieecFwAZ9xeirWtxsc6mCDbC__oCffkE6H0AGJcDXl5APv1YfYbX6opURBUb6N075TeiThnpYo8WJzAJWxtt1EjsyEiosfJ3ugAuswswZwM90evSQ',
    },
    substitute: {
      name: 'Crema de Arroz Hidrolizada',
      portionLabel: '52g (−8g seco)',
      kcal: 225,
      p: 4,
      c: 41,
      f: 1.5,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDtYA_sTutVwAAfnyaTRNAUvhC1HGER2lgjIfFg9TlkDLBNMkY56ofTQLVI3iL1IkGuC0QLovXvgfzwVwooLTf9nSW7invsJAS7HrlJMgms6WiUcRJ2C6gjxs2IBKnXwhOtn2cAHx213QThigxpu865NmBoqCSQn2bFa3OnMCTek29nNt3vQMY-KMETV4wcCb9gG8tvEj7oLc-7fbajRhmuAmIYZE7fIG_Ml2woCOQz4tdHmiEe4kkGiA',
    },
    deltaKcal: -2,
    macroBalanceNote: 'Carbohidratos complejos equivalentes',
    proteinRatioPct: 15,
    fatRatioPct: 85,
    specialNote: 'Para igualar fibra dietética se sugiere añadir 4g de semillas de chía o psyllium.',
  },
  {
    id: 'sub-4',
    category: 'grasas',
    categoryLabel: 'Lípidos Monoinsaturados',
    rule: 'Regla: Isocalórico (80 Kcal exactas)',
    factor: '0.24x (Alta densidad)',
    original: {
      name: 'Aguacate Hass Maduro',
      portionLabel: '50g de pulpa limpia',
      kcal: 80,
      p: 1.0,
      c: 4.0,
      f: 7.5,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBEdiGaRSA-BewMzRix-CvNpD6o4Hg5Kex86Po8zuqBdXJVqrv4yB-zfYIDlOBUGS3Db3plUIFB_3BjkDrwqCl_pSnE27oU36erVojVMfqqOvUWE28V6lvVseAujr4596_tW2j4rWXz1EGEjydoZ5fPZOfmsgUvIjFBfOegHCJPClLRtk99FrJF1_H2H68I5iVfHcEk5zmawDFhtLonoX1Kw1786vvgC2PCuJHrlD5OWoVaiddv4Zm6zw',
    },
    substitute: {
      name: 'Nueces de Nogal Peladas',
      portionLabel: '12g (aprox. 3 mitades)',
      kcal: 80,
      p: 1.8,
      c: 1.7,
      f: 8.0,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAVAoSWPKJDbwhTNOnytUfnts8I9s3mTKJLiGy2zQlRTgGEKJD0qjVd5bS7uTykHkAj7sNMGkW4bG8cm9JQrWBVPtGcwi-pAym1rZQEX_aPT78dLtkXsD7YVxip2GhuuvrGQqdV_1ik2BY6DSn-Nlbz5i9VLapMgk_Jqq59awMpKVPQgjR0ZfddZ7EPtAsLxaVsruOE26lHp-xuTrwAOkoyYOoRaVcX8cNJe-jOg-jIxkuc0pPyMLb-ag',
    },
    deltaKcal: 0,
    macroBalanceNote: 'Equilibrio Lípidos (80 kcal)',
    proteinRatioPct: 18,
    fatRatioPct: 82,
    specialNote: 'Alternativa líquida: 9ml de Aceite de Oliva Virgen Extra (AOVE).',
  },
  {
    id: 'sub-5',
    category: 'lacteos',
    categoryLabel: 'Lácteos Fermentados & Caseína',
    rule: 'Regla: Isoproteico (20g Proteína de digestión lenta)',
    factor: '0.875x',
    original: {
      name: 'Yogur Griego 0% Grasa',
      portionLabel: '200g netos',
      kcal: 118,
      p: 20,
      c: 8.0,
      f: 0,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAcmPuPQp6_BLxJzLePs1yQWN0WJZW5luftUxHNpnxZ3GTEHtCrnPcoVZCTz082t5fXJ83BXM_U5bls8BRd0joEiwRPU_dcH2Nv6YWm70wvNzIBQUvcJ5SlpOQI-vM2x0QXxjrjO8YEEMf-betrz1BgjHhYqLaOJiaJHtl23KdDzTKGr3C2C7p4fL0uAhReg5siAFboaMrDf91kDIh7mtF3Q15Vz5IkvJ6BexPF4JBD2RcHqD1n_g5nOg',
    },
    substitute: {
      name: 'Queso Cottage Desnatado',
      portionLabel: '175g (−25g)',
      kcal: 120,
      p: 21,
      c: 6.0,
      f: 1.5,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAtkdhtvb2RX7Fi8jR2m7bCULB7QLCoD_zimUX0pphXSepvJWZd4JfncGSas6e825Kppni7HvbDgDInvfgwfZ_3BGF0qt4OMTG4ETGOY0b5Pfgss9M6Wg623AcVq8_eNeL90M8E0urOhV44FIg2zdNGO4k7fMj0vpaQvCVL7NRwSKZ4r9i-Ad57_VWbr3cDWgG4wyY2yR3b81LD_nroUiDADySvnxfqyeQsg6NSxw0BvLy_n3maJSNFNg',
    },
    deltaKcal: 2,
    macroBalanceNote: 'Delta: +2 kcal (1.6% varianza)',
    proteinRatioPct: 87,
    fatRatioPct: 13,
    specialNote: 'Delta: +2 kcal (1.6% varianza). Ideal para tomas nocturnas antes de dormir.',
  },
];

export const SubstitutionsView: React.FC = () => {
  const { showToast, navigate } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [equivalenceMode, setEquivalenceMode] = useState<'isocalorico' | 'isoproteico' | 'isoglucido'>('isocalorico');

  // Interactive Live Calculator state
  const [calcSourceGrams, setCalcSourceGrams] = useState<number>(180);
  const [calcSourceFood, setCalcSourceFood] = useState<string>('pollo');
  const [calcTargetFood, setCalcTargetFood] = useState<string>('merluza');

  // Conversion rates dictionary
  const conversionRates: Record<string, Record<string, { factor: number; proteinPer100: number; targetName: string; note: string }>> = {
    pollo: {
      merluza: { factor: 1.305, proteinPer100: 24, targetName: 'Merluza / Pescado blanco magro', note: '+5g AOVE recomendado para igualar lípidos intramusculares del pollo original.' },
      pavo: { factor: 1.10, proteinPer100: 28, targetName: 'Lomo de pavo fileteado', note: 'Aporte de leucina idéntico y muy bajo contenido graso.' },
      ternera: { factor: 0.95, proteinPer100: 32, targetName: 'Solomillo de ternera magra', note: 'Mayor biodisponibilidad de hierro hemo y creatina natural.' },
      huevos: { factor: 2.8, proteinPer100: 11, targetName: 'Claras de huevo pasteurizadas', note: 'Perfil óptimo de albúmina sin grasa saturada.' },
      tofu: { factor: 1.85, proteinPer100: 17, targetName: 'Tofu firme bio', note: 'Añadir 2g de leucina aislada para emparejar síntesis proteica.' },
    },
    salmon: {
      merluza: { factor: 1.25, proteinPer100: 24, targetName: 'Merluza fresca', note: 'Añadir 12ml de AOVE para compensar el perfil lipídico del salmón.' },
      pavo: { factor: 1.05, proteinPer100: 28, targetName: 'Lomo de pavo fileteado', note: 'Añadir suplemento Omega-3 (1,000mg EPA/DHA).' },
      ternera: { factor: 0.9, proteinPer100: 32, targetName: 'Ternera magra', note: 'Equilibrio calórico similar.' },
      huevos: { factor: 2.2, proteinPer100: 11, targetName: 'Claras de huevo', note: 'Añadir 10g de semillas de lino molidas.' },
      tofu: { factor: 1.6, proteinPer100: 17, targetName: 'Tofu firme bio', note: 'Añadir aceite de linaza para balance Omega-3.' },
    },
    avena: {
      merluza: { factor: 0.8, proteinPer100: 24, targetName: 'Merluza', note: 'Cambio de macro foco (Carbohidrato a Proteína).' },
      pavo: { factor: 0.8, proteinPer100: 28, targetName: 'Pavo', note: 'Cambio de macro foco (Carbohidrato a Proteína).' },
      ternera: { factor: 0.7, proteinPer100: 32, targetName: 'Ternera', note: 'Cambio de macro foco.' },
      huevos: { factor: 1.5, proteinPer100: 11, targetName: 'Claras de huevo', note: 'Proteína sin almidones.' },
      tofu: { factor: 1.2, proteinPer100: 17, targetName: 'Tofu firme bio', note: 'Equivalencia aproximada.' },
    },
    aguacate: {
      merluza: { factor: 0.3, proteinPer100: 24, targetName: 'Pescado', note: 'Reemplazo de lípidos a proteínas.' },
      pavo: { factor: 0.3, proteinPer100: 28, targetName: 'Pavo', note: 'Reemplazo de grasas a proteínas.' },
      ternera: { factor: 0.25, proteinPer100: 32, targetName: 'Ternera', note: 'Reemplazo de grasas.' },
      huevos: { factor: 0.6, proteinPer100: 11, targetName: 'Claras', note: 'Reemplazo.' },
      tofu: { factor: 0.5, proteinPer100: 17, targetName: 'Tofu', note: 'Reemplazo.' },
    },
    yogur: {
      merluza: { factor: 0.5, proteinPer100: 24, targetName: 'Merluza', note: 'Isoproteico lácteo a marino.' },
      pavo: { factor: 0.45, proteinPer100: 28, targetName: 'Pavo', note: 'Isoproteico lácteo a ave.' },
      ternera: { factor: 0.4, proteinPer100: 32, targetName: 'Ternera', note: 'Isoproteico.' },
      huevos: { factor: 1.1, proteinPer100: 11, targetName: 'Claras', note: 'Isoproteico.' },
      tofu: { factor: 0.75, proteinPer100: 17, targetName: 'Tofu', note: 'Isoproteico vegetal.' },
    },
  };

  const currentCalc = useMemo(() => {
    const srcMap = conversionRates[calcSourceFood] || conversionRates['pollo'];
    const rateData = srcMap[calcTargetFood] || srcMap['merluza'];
    const calculatedGrams = Math.round(calcSourceGrams * rateData.factor);
    const proteinEstimated = Math.round(((calculatedGrams * rateData.proteinPer100) / 100) * 10) / 10;
    return {
      ratio: rateData.factor,
      resultWeight: calculatedGrams,
      protein: proteinEstimated,
      targetName: rateData.targetName,
      recommendation: rateData.note,
    };
  }, [calcSourceGrams, calcSourceFood, calcTargetFood]);

  const filteredCards = useMemo(() => {
    return initialCards.filter(card => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        card.original.name.toLowerCase().includes(q) ||
        card.substitute.name.toLowerCase().includes(q) ||
        card.categoryLabel.toLowerCase().includes(q);

      const matchesGroup =
        selectedGroup === 'all' || card.category === selectedGroup;

      return matchesSearch && matchesGroup;
    });
  }, [searchQuery, selectedGroup]);

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-lg animate-in fade-in duration-150">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Vigor Precision Nutrition Engine
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container-low text-primary font-label-sm text-label-sm font-medium">
              <span className="material-symbols-outlined text-xs text-primary">verified</span>
              Algoritmo Verificado ±3% Kcal
            </span>
          </div>
          <div className="flex items-baseline gap-space-sm flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
              Catálogo de Sustituciones Alimentarias
            </h1>
            <span className="font-code-data text-code-data text-on-surface-variant font-medium hidden sm:inline-block">
              v4.2.1 • Sincronizado USDA SR Legacy
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
            Matriz bidireccional isocalórica e isomacronutricional calibrada para atletas de alto rendimiento. Modifica tus fuentes alimentarias sin alterar la partición de energía, la síntesis proteica ni la cuota de fibra prescrita en tu menú semanal.
          </p>
        </div>

        <div className="flex items-center gap-space-sm bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container/50 shrink-0">
          <div className="flex flex-col pr-space-md">
            <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">
              Concordancia con Excel Maestro
            </span>
            <span className="font-code-data text-code-data font-semibold text-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              320 Matrices Activas
            </span>
          </div>
          <button
            onClick={() => showToast('Historial: última calibración hace 3 días (v4.2.1)')}
            className="flex items-center gap-space-xs px-3 py-1.5 bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg transition-colors cursor-pointer border border-surface-container/40"
            type="button"
          >
            <span className="material-symbols-outlined text-sm">history</span>
            <span>Historial de Cambios</span>
          </button>
        </div>
      </div>

      {/* Live Telemetry KPI Banners */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <div className="p-space-md bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase text-on-surface-variant font-semibold">
              Varianza Máxima Permitida
            </span>
            <span className="material-symbols-outlined text-primary text-base">balance</span>
          </div>
          <div className="flex items-baseline gap-space-xs mt-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tracking-tight">±2.8%</span>
            <span className="font-label-md text-label-md text-on-surface-variant">delta calórico</span>
          </div>
          <span className="font-code-data text-code-data text-primary mt-space-xs flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">check_circle</span> Protege cetosis o masa magra
          </span>
        </div>

        <div className="p-space-md bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase text-on-surface-variant font-semibold">
              Fuentes de Proteína Cruda
            </span>
            <span className="material-symbols-outlined text-tertiary text-base">fitness_center</span>
          </div>
          <div className="flex items-baseline gap-space-xs mt-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tracking-tight">115</span>
            <span className="font-label-md text-label-md text-on-surface-variant">alimentos catalogados</span>
          </div>
          <span className="font-code-data text-code-data text-on-surface-variant mt-space-xs">
            Completitud DIAAS &gt; 1.05
          </span>
        </div>

        <div className="p-space-md bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase text-on-surface-variant font-semibold">
              Carbohidratos y Almidones
            </span>
            <span className="material-symbols-outlined text-secondary text-base">grain</span>
          </div>
          <div className="flex items-baseline gap-space-xs mt-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tracking-tight">95</span>
            <span className="font-label-md text-label-md text-on-surface-variant">almidones y tubérculos</span>
          </div>
          <span className="font-code-data text-code-data text-on-surface-variant mt-space-xs">
            Normalizado a peso en seco
          </span>
        </div>

        <div className="p-space-md bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase text-on-surface-variant font-semibold">
              Grasas y Lípidos Cardiosaludables
            </span>
            <span className="material-symbols-outlined text-primary-container text-base">opacity</span>
          </div>
          <div className="flex items-baseline gap-space-xs mt-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tracking-tight">60</span>
            <span className="font-label-md text-label-md text-on-surface-variant">fuentes lipídicas</span>
          </div>
          <span className="font-code-data text-code-data text-primary mt-space-xs">
            Control de ratios Omega-3 / 6
          </span>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col md:flex-row gap-space-md items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por alimento original o sustituto (ej: pollo, salmón, avena, aguacate, yogur...)"
              className="w-full pl-10 pr-4 py-2 bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 border border-surface-container/40 placeholder:text-on-surface-variant/70 transition-all"
            />
          </div>

          <div className="flex items-center gap-space-xs shrink-0 bg-surface-container-low p-1 rounded-lg border border-surface-container/40">
            <button
              type="button"
              onClick={() => setEquivalenceMode('isocalorico')}
              className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-all ${
                equivalenceMode === 'isocalorico'
                  ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Isocalórico
            </button>
            <button
              type="button"
              onClick={() => setEquivalenceMode('isoproteico')}
              className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-all ${
                equivalenceMode === 'isoproteico'
                  ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Isoproteico
            </button>
            <button
              type="button"
              onClick={() => setEquivalenceMode('isoglucido')}
              className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-all ${
                equivalenceMode === 'isoglucido'
                  ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Isoglúcido
            </button>
          </div>
        </div>

        {/* Macro Dominant Categories Chips */}
        <div className="flex items-center gap-space-xs overflow-x-auto pb-1 text-nowrap scrollbar-none">
          {[
            { id: 'all', label: 'Todos los grupos (320)' },
            { id: 'proteina', label: 'Fuentes de Proteína (115)' },
            { id: 'carbohidratos', label: 'Fuentes de Carbohidratos (95)' },
            { id: 'grasas', label: 'Grasas Saludables (60)' },
            { id: 'lacteos', label: 'Lácteos & Caseína (28)' },
            { id: 'vegetales', label: 'Vegetales y Fibra (50)' },
          ].map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedGroup(g.id)}
              className={`px-3 py-1 rounded-full font-label-md text-label-md font-medium transition-all ${
                selectedGroup === g.id
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Workspace: Split Grid (8 Cols Cards Matrix + 4 Cols Calculator) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        {/* Left Column: Cards Matrix (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col gap-space-md">
          {filteredCards.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl p-space-xl text-center text-on-surface-variant">
              No se encontraron alimentos coincidentes con "{searchQuery}".
            </div>
          ) : (
            filteredCards.map(card => (
              <article
                key={card.id}
                className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 hover:shadow-md transition-all flex flex-col gap-space-md"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-space-xs border-b border-surface-container/40">
                  <div className="flex items-center gap-space-xs flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-fixed font-label-sm text-label-sm font-semibold">
                      {card.categoryLabel}
                    </span>
                    <span className="font-code-data text-code-data text-on-surface-variant">{card.rule}</span>
                  </div>
                  <div className="flex items-center gap-space-xs bg-primary-fixed/40 px-2 py-0.5 rounded-md text-primary font-code-data text-code-data font-semibold">
                    <span className="material-symbols-outlined text-xs">sync_alt</span> Factor: {card.factor}
                  </div>
                </div>

                {/* Dual Visual Comparison Layout */}
                <div className="grid grid-cols-1 md:grid-cols-11 gap-space-sm items-center">
                  {/* Original Food Box (5 Cols) */}
                  <div className="md:col-span-5 p-space-sm bg-surface-container-low rounded-lg flex flex-col gap-space-xs border border-surface-container/40">
                    <div className="flex items-center gap-space-sm">
                      <img
                        className="w-14 h-14 rounded-lg object-cover shrink-0 shadow-xs"
                        alt={card.original.name}
                        src={card.original.img}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                          Alimento Original
                        </span>
                        <h2 className="font-headline-sm text-headline-sm text-on-surface truncate font-semibold">
                          {card.original.name}
                        </h2>
                        <span className="font-code-data text-code-data font-semibold text-primary">
                          {card.original.portionLabel}
                        </span>
                      </div>
                    </div>
                    {/* Macro pill bar */}
                    <div className="grid grid-cols-4 gap-1 text-center bg-surface-container-lowest p-1.5 rounded-md mt-1 border border-surface-container/40">
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-on-surface-variant">Kcal</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.original.kcal}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-primary">P</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.original.p}g
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-secondary">C</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.original.c}g
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-tertiary">G</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.original.f}g
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Swap Indicator (1 Col) */}
                  <div className="md:col-span-1 flex flex-col items-center justify-center my-1 md:my-0">
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface shadow-xs">
                      <span className="material-symbols-outlined text-sm">swap_horiz</span>
                    </div>
                  </div>

                  {/* Substitute Food Box (5 Cols) */}
                  <div className="md:col-span-5 p-space-sm bg-surface-container-high rounded-lg flex flex-col gap-space-xs border border-surface-container">
                    <div className="flex items-center gap-space-sm">
                      <img
                        className="w-14 h-14 rounded-lg object-cover shrink-0 shadow-xs"
                        alt={card.substitute.name}
                        src={card.substitute.img}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-semibold">
                          Sustituto Óptimo
                        </span>
                        <h2 className="font-headline-sm text-headline-sm text-on-surface truncate font-semibold">
                          {card.substitute.name}
                        </h2>
                        <span className="font-code-data text-code-data font-bold text-on-surface">
                          {card.substitute.portionLabel}
                        </span>
                      </div>
                    </div>
                    {/* Macro pill bar */}
                    <div className="grid grid-cols-4 gap-1 text-center bg-surface-container-lowest p-1.5 rounded-md mt-1 border border-surface-container/40">
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-on-surface-variant">Kcal</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.substitute.kcal}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-primary">P</span>
                        <span className="font-label-md text-label-md font-semibold text-primary">
                          {card.substitute.p}g
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-secondary">C</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.substitute.c}g
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-label-sm text-label-sm text-tertiary">G</span>
                        <span className="font-label-md text-label-md font-semibold text-on-surface">
                          {card.substitute.f}g
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Secondary Option Callout Pill if any */}
                {card.secondaryOption && (
                  <div className="p-2.5 rounded-lg bg-surface-container flex items-center justify-between text-on-surface text-sm">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-tertiary text-sm">alt_route</span>
                      <span className="font-body-md text-body-md">
                        Opción Alternativa Magra: <strong>{card.secondaryOption}</strong>
                      </span>
                    </div>
                    <span className="font-code-data text-code-data bg-surface-container-lowest px-2 py-0.5 rounded text-primary font-medium">
                      {card.secondaryOptionKcal}
                    </span>
                  </div>
                )}

                {/* Comparative Inline Telemetry Bar */}
                <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col gap-1.5 border border-surface-container/30">
                  <div className="flex justify-between items-center text-on-surface-variant text-xs">
                    <span className="font-label-sm text-label-sm uppercase">{card.macroBalanceNote}</span>
                    <span className="font-code-data text-code-data text-primary font-medium">
                      Δ Kcal: {card.deltaKcal >= 0 ? `+${card.deltaKcal}` : card.deltaKcal} kcal
                    </span>
                  </div>
                  <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden flex">
                    <div
                      className="bg-primary h-full"
                      style={{ width: `${card.proteinRatioPct}%` }}
                      title="Proteína"
                    />
                    <div
                      className="bg-tertiary h-full"
                      style={{ width: `${card.fatRatioPct}%` }}
                      title="Grasas"
                    />
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex flex-wrap items-center justify-between gap-space-xs pt-space-xs">
                  {card.specialNote ? (
                    <span className="font-code-data text-code-data text-on-surface-variant text-xs">
                      {card.specialNote}
                    </span>
                  ) : (
                    <button
                      onClick={() => showToast('Perfil de aminoácidos: Leucina 2.8g, Isoleucina 1.6g, Valina 1.7g')}
                      className="text-on-surface-variant hover:text-on-surface font-label-md text-label-md flex items-center gap-1 transition-colors cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">data_object</span>
                      <span>Ver perfil de aminoácidos (BCAA / Leucina)</span>
                    </button>
                  )}

                  <div className="flex items-center gap-space-xs ml-auto">
                    <button
                      onClick={() => {
                        setCalcSourceGrams(100);
                        showToast(`Cargando ${card.original.name} en la calculadora lateral`);
                      }}
                      className="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg transition-colors cursor-pointer border border-surface-container/40"
                      type="button"
                    >
                      Personalizar Peso
                    </button>
                    <button
                      onClick={() => {
                        showToast(`¡Sustitución de ${card.substitute.name} aplicada al Menú Semanal!`);
                      }}
                      className="px-3 py-1.5 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg font-medium shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">done</span>
                      <span>Aplicar a Menú Semanal</span>
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {/* Right Column: Interactive Precision Calculator & Rules (4 Cols) */}
        <aside className="lg:col-span-4 flex flex-col gap-space-md sticky top-20">
          {/* Live Dynamic Calculator */}
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary">calculate</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Calculadora Dinámica de Equivalencias
                </h3>
              </div>
              <span className="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed px-2 py-0.5 rounded-full font-bold">
                En Vivo
              </span>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant text-xs">
              Ajusta los gramos prescritos en tu plan y obtén el peso exacto del sustituto en tiempo real con compensación de macronutrientes.
            </p>

            <form className="flex flex-col gap-space-sm" onSubmit={e => e.preventDefault()}>
              {/* Source Item */}
              <div className="flex flex-col gap-1">
                <label className="font-label-sm text-label-sm uppercase text-on-surface-variant font-medium">
                  Tengo Alimento Original
                </label>
                <div className="flex gap-space-xs">
                  <div className="relative w-28 shrink-0">
                    <input
                      type="number"
                      min="1"
                      max="2000"
                      value={calcSourceGrams}
                      onChange={e => setCalcSourceGrams(Math.max(1, Number(e.target.value)))}
                      className="w-full h-9 pl-3 pr-8 bg-surface-container-low rounded-lg font-code-data text-code-data text-on-surface focus:outline-none focus:ring-1 focus:ring-primary border border-surface-container"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-label-sm text-label-sm text-on-surface-variant">
                      g
                    </span>
                  </div>
                  <select
                    value={calcSourceFood}
                    onChange={e => setCalcSourceFood(e.target.value)}
                    className="flex-1 h-9 px-3 bg-surface-container-low rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary truncate border border-surface-container"
                  >
                    <option value="pollo">Pechuga de pollo (cruda)</option>
                    <option value="salmon">Salmón fresco</option>
                    <option value="avena">Avena en hojuelas</option>
                    <option value="aguacate">Aguacate Hass</option>
                    <option value="yogur">Yogur griego 0%</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-center -my-1 text-on-surface-variant">
                <span className="material-symbols-outlined text-base">arrow_downward</span>
              </div>

              {/* Target Food */}
              <div className="flex flex-col gap-1">
                <label className="font-label-sm text-label-sm uppercase text-on-surface-variant font-medium">
                  ¿Cuánto equivale en?
                </label>
                <select
                  value={calcTargetFood}
                  onChange={e => setCalcTargetFood(e.target.value)}
                  className="w-full h-9 px-3 bg-surface-container-low rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary border border-surface-container"
                >
                  <option value="merluza">Merluza / Pescado blanco magro</option>
                  <option value="pavo">Lomo de pavo fileteado</option>
                  <option value="ternera">Solomillo de ternera magra</option>
                  <option value="huevos">Claras de huevo pasteurizadas</option>
                  <option value="tofu">Tofu firme bio</option>
                </select>
              </div>

              {/* Calculated Telemetry Box */}
              <div className="mt-space-xs p-space-sm bg-surface-container-high rounded-xl flex flex-col gap-space-xs border border-surface-container">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm uppercase font-semibold text-primary">
                    Resultado Calculado
                  </span>
                  <span className="font-code-data text-code-data text-on-surface-variant">
                    Ratio: {currentCalc.ratio}x
                  </span>
                </div>
                <div className="flex items-baseline gap-space-xs">
                  <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">
                    {currentCalc.resultWeight}
                  </span>
                  <span className="font-label-md text-label-md font-semibold text-on-surface">gramos</span>
                  <span className="font-body-md text-body-md text-on-surface-variant truncate">
                    de {currentCalc.targetName}
                  </span>
                </div>

                <div className="p-2 bg-surface-container-lowest rounded-md flex items-start gap-2 text-on-surface border border-surface-container/50">
                  <span className="material-symbols-outlined text-primary text-sm shrink-0 mt-0.5">info</span>
                  <p className="font-code-data text-code-data text-on-surface-variant text-[11px]">
                    {currentCalc.recommendation}
                  </p>
                </div>

                <div className="flex flex-col gap-1 mt-1">
                  <div className="flex justify-between font-code-data text-code-data text-on-surface-variant text-xs">
                    <span>Proteína aportada</span>
                    <span className="font-bold text-primary">{currentCalc.protein}g P (±0.0g Δ)</span>
                  </div>
                  <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                    <div className="bg-primary h-full w-[99%]" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  showToast(`Equivalencia de ${currentCalc.resultWeight}g aplicada en Registro Diario`);
                  navigate('registro-diario');
                }}
                className="w-full h-9 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg font-medium transition-colors shadow-xs flex items-center justify-center gap-space-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">bolt</span>
                <span>Reemplazar en Registro Diario</span>
              </button>
            </form>
          </div>

          {/* Protocol & Clinical Rules */}
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-sm">
            <div className="flex items-center gap-space-xs pb-1 border-b border-surface-container/40">
              <span className="material-symbols-outlined text-tertiary">menu_book</span>
              <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Protocolo Clínico de Equivalencias
              </h4>
            </div>
            <ul className="flex flex-col gap-space-xs font-body-md text-body-md text-on-surface-variant text-xs">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <span>
                  <strong>Midiendo en seco vs cocido:</strong> Toda sustitución de hidratos asume gramaje en crudo a menos que se indique explícitamente.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <span>
                  <strong>Tolerancia Máxima:</strong> Si la varianza calórica excede el 4%, el SaaS añade automáticamente un compensador de grasa o carbohidrato simple.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <span>
                  <strong>Sodio y Micronutrientes:</strong> Cambios entre carnes rojas y pescados pueden alterar la retención hídrica por balance Na/K transitorio.
                </span>
              </li>
            </ul>
            <div className="pt-space-xs">
              <button
                onClick={() => showToast('Descargando Matriz Maestra de Equivalencias en PDF/Excel...')}
                className="font-label-md text-label-md text-primary font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                type="button"
              >
                <span>Descargar Tabla Maestra en PDF / Excel</span>
                <span className="material-symbols-outlined text-sm">download</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
