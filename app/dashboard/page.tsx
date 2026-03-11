'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import CONFIG from './lib/config';
import DataService from './lib/dataService';
import CompareEngine, { type Comparativa } from './lib/compareEngine';
import { renderizarChart, limpiarChart } from './lib/chartRenderer';
import LogoutButton from '../components/LogoutButton';

const FILTROS = [
  { campo: 'programa.sub_direccion', label: 'Sub Dirección' },
  { campo: 'programa.cartera', label: 'Cartera' },
  { campo: 'programa.jp', label: 'JP' },
  { campo: 'programa.estado', label: 'Estado' },
  { campo: 'programa.origen', label: 'Origen' },
];

interface FilterDropdownProps {
  campo: string;
  label: string;
  filtrosActivos: Record<string, string[]>;
  onFiltroChange: (campo: string, valores: string[]) => void;
}

function FilterDropdown({ campo, label, filtrosActivos, onFiltroChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const valores = DataService.getValoresUnicosFiltrados(campo, filtrosActivos);
  const lower = search.toLowerCase();
  const filtrados = valores.filter(v => !lower || v.toLowerCase().includes(lower));
  const seleccionados = filtrosActivos[campo] || [];
  const todosChecked = filtrados.length > 0 && filtrados.every(v => seleccionados.includes(v));
  const hasSelection = seleccionados.length > 0;

  const displayLabel = seleccionados.length === 0
    ? label
    : seleccionados.length === 1
      ? seleccionados[0]
      : `${label} (${seleccionados.length})`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`w-full text-left rounded-md border shadow-sm text-sm p-2 bg-white flex items-center justify-between hover:border-gray-400 ${hasSelection ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}
      >
        <span className="truncate">{displayLabel}</span>
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg" onClick={e => e.stopPropagation()}>
          <div className="p-2 border-b border-gray-100">
            <input type="text" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1" autoFocus />
          </div>
          <div className="max-h-48 overflow-y-auto p-2 space-y-1">
            <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer text-xs font-semibold border-b border-gray-100 mb-1">
              <input type="checkbox" className="rounded border-gray-300" checked={todosChecked}
                onChange={e => {
                  if (e.target.checked) {
                    const nuevos = [...seleccionados];
                    filtrados.forEach(v => { if (!nuevos.includes(v)) nuevos.push(v); });
                    onFiltroChange(campo, nuevos);
                  } else {
                    onFiltroChange(campo, seleccionados.filter(v => !filtrados.includes(v)));
                  }
                }} />
              <span>Todos</span>
            </label>
            {filtrados.map(valor => (
              <label key={valor} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-50 cursor-pointer text-xs">
                <input type="checkbox" className="rounded border-gray-300" checked={seleccionados.includes(valor)}
                  onChange={e => {
                    if (e.target.checked) {
                      onFiltroChange(campo, [...seleccionados, valor]);
                    } else {
                      onFiltroChange(campo, seleccionados.filter(v => v !== valor));
                    }
                  }} />
                <span className="truncate">{valor}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ProgramaDropdownProps {
  programas: { codigo: string; nombre: string }[];
  seleccionados: string[];
  onChange: (sel: string[]) => void;
}

function ProgramaDropdown({ programas, seleccionados, onChange }: ProgramaDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const lower = search.toLowerCase();
  const filtrados = programas.filter(p => !lower || p.nombre.toLowerCase().includes(lower));
  const todosChecked = filtrados.length > 0 && filtrados.every(p => seleccionados.includes(p.codigo));

  const displayLabel = seleccionados.length === 0
    ? `Todos los filtrados (${programas.length})`
    : seleccionados.length === 1
      ? (programas.find(p => p.codigo === seleccionados[0])?.nombre || seleccionados[0])
      : `${seleccionados.length} programas seleccionados`;

  const hasSelection = seleccionados.length > 0;

  return (
    <div ref={ref} className="relative">
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`w-full text-left rounded-md border shadow-sm text-sm p-2 bg-white flex items-center justify-between hover:border-gray-400 ${hasSelection ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}
      >
        <span className="truncate">{displayLabel}</span>
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg" onClick={e => e.stopPropagation()}>
          <div className="p-2 border-b border-gray-100">
            <input type="text" placeholder="Buscar programa..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1" autoFocus />
          </div>
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer text-xs font-semibold border-b border-gray-100 mb-1">
              <input type="checkbox" className="rounded border-gray-300" checked={todosChecked}
                onChange={e => {
                  if (e.target.checked) {
                    const nuevos = [...seleccionados];
                    filtrados.forEach(p => { if (!nuevos.includes(p.codigo)) nuevos.push(p.codigo); });
                    onChange(nuevos);
                  } else {
                    const codigosVisible = new Set(filtrados.map(p => p.codigo));
                    onChange(seleccionados.filter(c => !codigosVisible.has(c)));
                  }
                }} />
              <span>Todos</span>
            </label>
            {filtrados.map(p => (
              <label key={p.codigo} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-50 cursor-pointer text-xs">
                <input type="checkbox" className="rounded border-gray-300" checked={seleccionados.includes(p.codigo)}
                  onChange={e => {
                    if (e.target.checked) {
                      onChange([...seleccionados, p.codigo]);
                    } else {
                      onChange(seleccionados.filter(c => c !== p.codigo));
                    }
                  }} />
                <span className="truncate">{p.nombre}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataStatus, setDataStatus] = useState('');
  const [filtrosActivos, setFiltrosActivos] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    FILTROS.forEach(f => { init[f.campo] = []; });
    return init;
  });
  const [programasSeleccionados, setProgramasSeleccionados] = useState<string[]>([]);
  const [metrica, setMetrica] = useState('total_convertidos');
  const [fechaConsulta, setFechaConsulta] = useState(() => new Date().toISOString().slice(0, 10));
  const [modo, setModo] = useState<'alumnos' | 'pxq'>('alumnos');
  const [processing, setProcessing] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);

  // Keep config in sync with mode (synchronous, runs every render)
  CONFIG._modo = modo;

  const defaultKpiState = {
    y2026: {} as Record<string, number | null>,
    y2025: {} as Record<string, number | null>,
    inaug2026: null as string | null,
    inaug2025: null as string | null,
    diasParaInaug: null as number | null,
    parInfo: 'Todos los programas filtrados',
  };

  // Load data (reload when mode changes since CSVs are different for alumnos vs pxq)
  useEffect(() => {
    setDataLoaded(false);
    setLoading(true);
    DataService.cargarTodo().then(() => {
      const s = DataService.store;
      setDataStatus(
        `${s.datamart2025.length.toLocaleString()} filas 2025 · ${s.datamart2026.length.toLocaleString()} filas 2026 · ${DataService.getParesValidos().length} pares`
      );
      setDataLoaded(true);
      setLoading(false);
    }).catch(err => {
      console.error('Error cargando datos:', err);
      setDataStatus('Error al cargar datos');
      setLoading(false);
    });
  }, [modo]);

  // Get filtered programs (memoized)
  const programasFiltrados = useMemo(
    () => dataLoaded ? DataService.getProgramas2026ConPar(filtrosActivos) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataLoaded, JSON.stringify(filtrosActivos)]
  );

  // Clean selections when filters change
  useEffect(() => {
    if (!dataLoaded) return;
    const codigosFiltrados = new Set(programasFiltrados.map(p => p.codigo));
    setProgramasSeleccionados(prev => {
      const filtered = prev.filter(c => codigosFiltrados.has(c));
      if (filtered.length === prev.length) return prev;
      return filtered;
    });
  }, [dataLoaded, programasFiltrados]);

  const handleFiltroChange = useCallback((campo: string, valores: string[]) => {
    setProcessing(true);
    setTimeout(() => {
      setFiltrosActivos(prev => ({ ...prev, [campo]: valores }));
    }, 0);
  }, []);

  const limpiarFiltros = useCallback(() => {
    setProcessing(true);
    setTimeout(() => {
      const init: Record<string, string[]> = {};
      FILTROS.forEach(f => { init[f.campo] = []; });
      setFiltrosActivos(init);
      setProgramasSeleccionados([]);
    }, 0);
  }, []);

  const hayFiltros = Object.values(filtrosActivos).some(v => v.length > 0);

  // Compute comparativa results (pure computation, no side effects, no state updates)
  const comparativaData = useMemo(() => {
    if (!dataLoaded) return null;

    const metricaLabel = CONFIG.metricas[metrica]?.label || metrica;

    let codigos: string[];
    if (programasSeleccionados.length > 0) {
      codigos = programasSeleccionados;
    } else {
      codigos = programasFiltrados.map(p => p.codigo);
    }

    if (codigos.length === 0) {
      return { kpiState: { ...defaultKpiState }, comparativa: null, comparativaLeads: null, metricaLabel };
    }

    let inaugRef2026: string | null = null;
    codigos.forEach(cod => {
      const prog = DataService.getPrograma(cod, 2026);
      if (!prog) return;
      const inaug = prog[CONFIG.campos.inauguracion] as string;
      if (inaug && (!inaugRef2026 || inaug > inaugRef2026)) inaugRef2026 = inaug;
    });

    let extraDias = 0;
    if (fechaConsulta && inaugRef2026) {
      const fc = new Date(fechaConsulta + 'T00:00:00');
      const fi = new Date(inaugRef2026 + 'T00:00:00');
      const diffMs = fc.getTime() - fi.getTime();
      extraDias = Math.max(0, Math.round(diffMs / 86400000));
    }

    const comparativa = codigos.length === 1
      ? CompareEngine.generarComparativa(codigos[0], metrica, extraDias)
      : CompareEngine.generarComparativaMultiple(codigos, metrica, extraDias);

    if (!comparativa) {
      return {
        kpiState: { ...defaultKpiState, parInfo: 'Sin par disponible' },
        comparativa: null, comparativaLeads: null, metricaLabel,
      };
    }

    const comparativaLeads = CONFIG._modo !== 'pxq'
      ? (codigos.length === 1
          ? CompareEngine.generarComparativa(codigos[0], 'total_leads', extraDias)
          : CompareEngine.generarComparativaMultiple(codigos, 'total_leads', extraDias))
      : null;

    const comparativasPorMetrica: Record<string, Comparativa | null> = {
      total_leads: comparativaLeads,
      [metrica]: comparativa,
    };

    const getComparativaMetrica = (metricaKey: string) => {
      if (comparativasPorMetrica[metricaKey]) return comparativasPorMetrica[metricaKey];
      const comp = codigos.length === 1
        ? CompareEngine.generarComparativa(codigos[0], metricaKey, extraDias)
        : CompareEngine.generarComparativaMultiple(codigos, metricaKey, extraDias);
      comparativasPorMetrica[metricaKey] = comp;
      return comp;
    };

    const comparativaTuberia = getComparativaMetrica('total_tuberia');
    const comparativaMatriculados = getComparativaMetrica('matriculados');
    const comparativaConvertidos = getComparativaMetrica('total_convertidos');

    const campoMeta = CONFIG._modo === 'pxq' ? 'programa.meta_ventas' : 'programa.minimo_nro_ventas';
    const calcularMeta = (codigosArr: string[], anio: number) => {
      let suma = 0;
      codigosArr.forEach(codigo => {
        const prog = DataService.getPrograma(codigo, anio);
        const meta = prog?.[campoMeta];
        if (meta != null && !isNaN(Number(meta))) suma += parseFloat(String(meta));
      });
      return suma > 0 ? suma : null;
    };

    const codigos2025 = codigos.map(c => DataService.buscarPar(c)).filter(Boolean) as string[];
    const meta2026 = calcularMeta(codigos, 2026);
    const meta2025 = calcularMeta(codigos2025, 2025);

    const diaObjetivo = (fechaConsulta && comparativa?.programa2026?.inauguracion)
      ? CompareEngine.diasParaInauguracion(fechaConsulta, comparativa.programa2026.inauguracion)
      : comparativa.kpis?.diasParaInaug;

    const getValorEnDia = (comp: Comparativa | null, anio: number) => {
      if (!comp || diaObjetivo == null) return null;
      const idxReal = comp.alineado?.labels?.indexOf(diaObjetivo) ?? -1;
      if (idxReal >= 0) {
        return anio === 2026 ? comp.alineado.serie2026[idxReal] : comp.alineado.serie2025[idxReal];
      }
      const idxProy = comp.proyeccion?.labels?.indexOf(diaObjetivo) ?? -1;
      if (idxProy >= 0) {
        return anio === 2026 ? comp.proyeccion.proyeccion[idxProy] : comp.proyeccion.serie2025Futuro[idxProy];
      }
      return anio === 2026 ? (comp.kpis?.actual2026 ?? null) : (comp.kpis?.equivalente2025 ?? null);
    };

    const mat2026 = getValorEnDia(comparativaMatriculados, 2026);
    const mat2025 = getValorEnDia(comparativaMatriculados, 2025);
    const conv2026 = getValorEnDia(comparativaConvertidos, 2026);
    const conv2025 = getValorEnDia(comparativaConvertidos, 2025);
    const leads2026 = CONFIG._modo !== 'pxq' ? getValorEnDia(comparativaLeads, 2026) : null;
    const leads2025 = CONFIG._modo !== 'pxq' ? getValorEnDia(comparativaLeads, 2025) : null;

    const avance2026 = (mat2026 != null && meta2026 != null && meta2026 > 0) ? (mat2026 / meta2026) * 100 : null;
    const avance2025 = (mat2025 != null && meta2025 != null && meta2025 > 0) ? (mat2025 / meta2025) * 100 : null;
    const conversion2026 = (conv2026 != null && leads2026 != null && leads2026 > 0) ? (conv2026 / leads2026) * 100 : null;
    const conversion2025 = (conv2025 != null && leads2025 != null && leads2025 > 0) ? (conv2025 / leads2025) * 100 : null;

    let parInfo = 'Todos los programas filtrados';
    const count = comparativa.programasIncluidos || 1;
    const paresCount = comparativa.paresIncluidos;
    if (count === 1) {
      if (comparativa.programa2025.sinPar || !comparativa.programa2025.inauguracion) {
        parInfo = 'Sin par 2025 para este programa';
      } else {
        parInfo = `${comparativa.programa2025.nombre} (inaug. ${comparativa.programa2025.inauguracion})`;
      }
    } else if (typeof paresCount === 'number') {
      if (paresCount === 0) {
        parInfo = `${count} programas sin par 2025`;
      } else if (paresCount === count) {
        parInfo = `${paresCount} pares agregados (ref. inaug. más lejana: ${comparativa.programa2026.inauguracion})`;
      } else {
        parInfo = `${count} programas agregados (${paresCount} con par 2025)`;
      }
    } else {
      parInfo = `${count} programas agregados`;
    }

    return {
      kpiState: {
        y2026: {
          leads: leads2026, tuberia: getValorEnDia(comparativaTuberia, 2026),
          matriculados: mat2026, convertidos: conv2026,
          conversion: conversion2026, meta: meta2026, avance: avance2026,
        },
        y2025: {
          leads: leads2025, tuberia: getValorEnDia(comparativaTuberia, 2025),
          matriculados: mat2025, convertidos: conv2025,
          conversion: conversion2025, meta: meta2025, avance: avance2025,
        },
        inaug2026: comparativa.programa2026.inauguracion,
        inaug2025: comparativa.programa2025.inauguracion,
        diasParaInaug: diaObjetivo ?? null,
        parInfo,
      },
      comparativa,
      comparativaLeads,
      metricaLabel,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, programasSeleccionados, programasFiltrados, metrica, fechaConsulta, modo, JSON.stringify(filtrosActivos)]);

  // Derived KPI state (no useState needed)
  const kpiState = comparativaData?.kpiState || defaultKpiState;

  // Chart rendering (DOM side-effect only)
  useEffect(() => {
    if (!chartRef.current) return;
    if (comparativaData?.comparativa) {
      renderizarChart(chartRef.current, comparativaData.comparativaLeads, comparativaData.comparativa, comparativaData.metricaLabel);
    } else {
      limpiarChart();
    }
    setProcessing(false);
  }, [comparativaData]);

  const esPxq = modo === 'pxq';
  const fmt = (v: number | null | undefined) => {
    if (v == null) return '—';
    const base = v.toLocaleString();
    return esPxq ? `S/ ${base}` : base;
  };
  const fmtPct = (v: number | null | undefined) => (v != null ? `${v.toFixed(1)}%` : '—');
  const fmtDiff = (val2026: number | null | undefined, val2025: number | null | undefined) => {
    if (val2026 == null || val2025 == null) return null;
    const diff = val2026 - val2025;
    if (diff === 0) return null;
    const sign = diff > 0 ? '+' : '';
    const color = diff > 0 ? 'text-green-600' : 'text-red-600';
    const valor = esPxq ? `S/ ${diff.toLocaleString()}` : diff.toLocaleString();
    return <span className={color}>({sign}{valor})</span>;
  };
  const fmtFecha = (iso: string | null) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const avance2026 = kpiState.y2026.avance;
  const avance2025 = kpiState.y2025.avance;
  const avanceColor2026 = avance2026 != null ? (avance2026 <= 80 ? 'text-red-600' : avance2026 <= 90 ? 'text-yellow-600' : 'text-green-600') : 'text-amber-500';
  const avanceColor2025 = avance2025 != null ? (avance2025 <= 80 ? 'text-red-600' : avance2025 <= 90 ? 'text-yellow-600' : 'text-green-600') : 'text-amber-500';

  const diasText = kpiState.diasParaInaug !== null
    ? (kpiState.diasParaInaug > 0 ? `${kpiState.diasParaInaug} días restantes`
       : kpiState.diasParaInaug === 0 ? 'Día de inauguración'
       : `${Math.abs(kpiState.diasParaInaug)} días post inaug.`)
    : '—';

  const inaugOffsetStr = kpiState.diasParaInaug != null
    ? ` ${kpiState.diasParaInaug > 0 ? '-' : '+'}${Math.abs(kpiState.diasParaInaug)}d`
    : '';

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-800">Comparativo de Programas</h1>
            <div className="flex items-center bg-gray-100 rounded-full p-0.5 text-xs font-semibold cursor-pointer select-none" style={{ minWidth: 140 }}>
              <span
                onClick={() => { if (modo !== 'alumnos') { setProcessing(true); setModo('alumnos'); } }}
                className={`flex-1 text-center px-3 py-1 rounded-full transition-all ${modo === 'alumnos' ? 'bg-white text-blue-800 shadow-sm' : 'text-gray-400'}`}
              >Alumnos</span>
              <span
                onClick={() => { if (modo !== 'pxq') { setProcessing(true); setModo('pxq'); } }}
                className={`flex-1 text-center px-3 py-1 rounded-full transition-all ${modo === 'pxq' ? 'bg-white text-blue-800 shadow-sm' : 'text-gray-400'}`}
              >PxQ</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Filtros */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Filtros</h2>
            {hayFiltros && (
              <button onClick={limpiarFiltros} className="text-xs text-blue-800 hover:underline">Limpiar filtros</button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {FILTROS.map(f => (
              <FilterDropdown
                key={f.campo}
                campo={f.campo}
                label={f.label}
                filtrosActivos={filtrosActivos}
                onFiltroChange={handleFiltroChange}
              />
            ))}
          </div>
        </section>

        {/* Selector de programa + par */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Programas 2026 <span className="text-xs text-gray-400 font-normal">({programasFiltrados.length})</span>
              </label>
              <ProgramaDropdown
                programas={programasFiltrados}
                seleccionados={programasSeleccionados}
                onChange={(sel) => { setProcessing(true); setTimeout(() => setProgramasSeleccionados(sel), 0); }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pares 2025</label>
              <div className="text-sm text-gray-700 p-2 bg-gray-50 rounded-md border border-gray-200 min-h-[38px] flex items-center">
                {kpiState.parInfo}
              </div>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* 2026 KPIs */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-gray-900 uppercase tracking-wide font-bold">2026</p>
              {kpiState.inaug2026 && (
                <span className="text-xs text-gray-600">
                  (<b>Inaug: {fmtFecha(kpiState.inaug2026)}{inaugOffsetStr}</b>)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {!esPxq && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Leads</span>
                  <span className="font-semibold text-blue-800 text-[10px]">
                    {fmt(kpiState.y2026.leads)} {fmtDiff(kpiState.y2026.leads, kpiState.y2025.leads)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Total Convertidos</span>
                <span className="font-semibold text-blue-800 text-[10px]">
                  {fmt(kpiState.y2026.convertidos)} {fmtDiff(kpiState.y2026.convertidos, kpiState.y2025.convertidos)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Tubería</span>
                <span className="font-semibold text-blue-800 text-[10px]">
                  {fmt(kpiState.y2026.tuberia)} {fmtDiff(kpiState.y2026.tuberia, kpiState.y2025.tuberia)}
                </span>
              </div>
              {!esPxq && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">% Conversión</span>
                  <span className="font-semibold text-blue-800 text-[10px]">{fmtPct(kpiState.y2026.conversion)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Matriculados</span>
                <span className="font-semibold text-blue-800 text-[10px]">
                  {fmt(kpiState.y2026.matriculados)} {fmtDiff(kpiState.y2026.matriculados, kpiState.y2025.matriculados)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Meta</span>
                <span className="font-semibold text-gray-700 text-[10px]">{fmt(kpiState.y2026.meta)}</span>
              </div>
              <div className="col-span-2 border-t border-gray-200 pt-1 mt-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">% Avance</span>
                  <span className={`font-bold ${avanceColor2026}`}>{fmtPct(avance2026)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2025 KPIs */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-gray-900 uppercase tracking-wide font-bold">2025</p>
              {kpiState.inaug2025 && (
                <span className="text-xs text-gray-600">
                  (<b>Inaug: {fmtFecha(kpiState.inaug2025)}{inaugOffsetStr}</b>)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {!esPxq && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Leads</span>
                  <span className="font-semibold text-purple-600 text-[10px]">{fmt(kpiState.y2025.leads)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Total Convertidos</span>
                <span className="font-semibold text-purple-600 text-[10px]">{fmt(kpiState.y2025.convertidos)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Tubería</span>
                <span className="font-semibold text-purple-600 text-[10px]">{fmt(kpiState.y2025.tuberia)}</span>
              </div>
              {!esPxq && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">% Conversión</span>
                  <span className="font-semibold text-purple-600 text-[10px]">{fmtPct(kpiState.y2025.conversion)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Matriculados</span>
                <span className="font-semibold text-purple-600 text-[10px]">{fmt(kpiState.y2025.matriculados)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Meta</span>
                <span className="font-semibold text-gray-700 text-[10px]">{fmt(kpiState.y2025.meta)}</span>
              </div>
              <div className="col-span-2 border-t border-gray-200 pt-1 mt-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">% Avance</span>
                  <span className={`font-bold ${avanceColor2025}`}>{fmtPct(avance2025)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Fecha consulta */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 text-center">
            <p className="text-sm text-gray-900 uppercase tracking-wide mb-2 font-bold">Fecha de consulta</p>
            <input type="date" value={fechaConsulta} onChange={e => { const v = e.target.value; setProcessing(true); setTimeout(() => setFechaConsulta(v), 0); }}
              className="w-full text-center text-sm font-bold text-amber-500 border border-gray-300 rounded-md p-1 focus:border-blue-800 focus:ring-blue-800" />
            <p className="text-sm text-gray-500 mt-1">{diasText}</p>
          </div>
        </section>

        {/* Gráfica */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Comparativa temporal relativa</h2>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3 text-xs">
                {!esPxq && (
                  <>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-800 inline-block"></span> Leads 2026</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-purple-600 inline-block"></span> Leads 2025</span>
                  </>
                )}
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{ background: '#059669' }}></span> {CONFIG.metricas[metrica]?.label || metrica} 2026</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{ background: '#d97706' }}></span> {CONFIG.metricas[metrica]?.label || metrica} 2025</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block border-2 border-dashed border-blue-800"></span> Proyección</span>
              </div>
              <select value={metrica} onChange={e => { const v = e.target.value; setProcessing(true); setTimeout(() => setMetrica(v), 0); }}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-800 focus:ring-blue-800 text-xs p-1.5 border">
                <option value="total_convertidos">Total Convertidos</option>
                <option value="total_tuberia">Total Tubería</option>
                <option value="matriculados">Matriculados</option>
              </select>
            </div>
          </div>
          <div className="relative" style={{ height: 400 }}>
            <canvas ref={chartRef}></canvas>
          </div>
        </section>
      </main>

      {/* Processing overlay */}
      {(processing || loading) && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-xl shadow-lg border border-gray-200">
            <svg className="animate-spin h-6 w-6 text-blue-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span className="text-sm font-medium text-gray-600">{loading ? 'Cargando datos...' : 'Procesando...'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
