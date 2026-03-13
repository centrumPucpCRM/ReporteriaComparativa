import CONFIG, { leerMetrica } from './config';
import DataService, { type DataRow } from './dataService';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Comparativa {
  programa2026: { codigo: string; nombre: string; inauguracion: string };
  programa2025: { codigo: string; nombre: string; inauguracion: string | null; sinPar: boolean };
  alineado: { labels: number[]; serie2026: (number | null)[]; serie2025: (number | null)[] };
  proyeccion: { labels: number[]; proyeccion: number[]; serie2025Futuro: (number | null)[] };
  kpis: { actual2026: number; equivalente2025: number | null; diferencia: number | null; diasParaInaug: number | null };
  programasIncluidos?: number;
  paresIncluidos?: number;
}

function diasParaInauguracion(fechaStr: string, inauguracionStr: string): number | null {
  if (!fechaStr || !inauguracionStr) return null;
  const fecha = new Date(fechaStr + 'T00:00:00');
  const inaug = new Date(inauguracionStr + 'T00:00:00');
  const diffMs = inaug.getTime() - fecha.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function enriquecerConDiasRelativos(metricas: DataRow[], inauguracionStr: string, extraDias = 0): DataRow[] {
  return metricas
    .map(fila => ({
      ...fila,
      dias_para_inaug: diasParaInauguracion(fila[CONFIG.campos.fecha], inauguracionStr),
    }))
    .filter(fila => fila.dias_para_inaug !== null && fila.dias_para_inaug >= -extraDias)
    .sort((a, b) => (b.dias_para_inaug as number) - (a.dias_para_inaug as number));
}

function alinearSeries(metricas2026: DataRow[], metricas2025: DataRow[], metrica: string, extraDias = 0) {
  const lookup2025Raw = new Map<number, number>();
  metricas2025.forEach(fila => {
    lookup2025Raw.set(fila.dias_para_inaug, leerMetrica(fila, metrica));
  });

  const maxDia2025 = metricas2025.length > 0 ? metricas2025[0].dias_para_inaug : 0;
  const minDia = -extraDias;
  const lookup2025 = new Map<number, number | null>();
  let carry: number | null = null;
  for (let d = maxDia2025; d >= minDia; d--) {
    if (lookup2025Raw.has(d)) {
      carry = lookup2025Raw.get(d)!;
    }
    lookup2025.set(d, carry);
  }

  const labels: number[] = [];
  const serie2026: (number | null)[] = [];
  const serie2025: (number | null)[] = [];

  metricas2026.forEach(fila => {
    const dia = fila.dias_para_inaug as number;
    const val2026 = leerMetrica(fila, metrica);
    const val2025 = lookup2025.has(dia) ? lookup2025.get(dia)! : null;
    labels.push(dia);
    serie2026.push(val2026);
    serie2025.push(val2025);
  });

  return { labels, serie2026, serie2025 };
}

function buscarValorCercano(lookup: Map<number, number | null>, dia: number): number | null {
  if (lookup.has(dia)) return lookup.get(dia)!;
  let minDist = Infinity, closest: number | null = null;
  for (const [d, v] of lookup) {
    const dist = Math.abs(d - dia);
    if (dist < minDist && dist <= 2) {
      minDist = dist;
      closest = v;
    }
  }
  return closest;
}

function proyectar(metricas2026: DataRow[], metricas2025: DataRow[], metrica: string, puntosBase = 14, extraDias = 0) {
  if (metricas2026.length === 0) return { labels: [] as number[], proyeccion: [] as number[], serie2025Futuro: [] as (number | null)[] };

  const ultimoDia = metricas2026[metricas2026.length - 1].dias_para_inaug as number;
  if (ultimoDia <= -extraDias) return { labels: [] as number[], proyeccion: [] as number[], serie2025Futuro: [] as (number | null)[] };

  const valorActual2026 = leerMetrica(metricas2026[metricas2026.length - 1], metrica);

  const lookup2025Raw = new Map<number, number>();
  metricas2025.forEach(fila => {
    lookup2025Raw.set(fila.dias_para_inaug, leerMetrica(fila, metrica));
  });

  const lookup2025 = new Map<number, number | null>();
  const maxDia2025 = metricas2025.length > 0 ? metricas2025[0].dias_para_inaug : 0;
  let carryVal: number | null = null;
  for (let d = maxDia2025; d >= -extraDias; d--) {
    if (lookup2025Raw.has(d)) {
      carryVal = lookup2025Raw.get(d)!;
    }
    lookup2025.set(d, carryVal);
  }

  const valor2025EnPuntoActual = lookup2025.has(ultimoDia) ? lookup2025.get(ultimoDia)! : buscarValorCercano(lookup2025, ultimoDia);

  let m = 0, bLin = 0;
  if (valor2025EnPuntoActual === null) {
    const recientes = metricas2026.slice(-puntosBase);
    const n = recientes.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    recientes.forEach((fila, i) => {
      const y = leerMetrica(fila, metrica);
      sumX += i; sumY += y; sumXY += i * y; sumX2 += i * i;
    });
    m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    bLin = (sumY - m * sumX) / n;
  }

  const labels: number[] = [];
  const proyeccion: number[] = [];
  const serie2025Futuro: (number | null)[] = [];

  for (let dia = ultimoDia - 1; dia >= -extraDias; dia--) {
    const val25 = lookup2025.has(dia) ? lookup2025.get(dia)! : null;
    serie2025Futuro.push(val25);
    labels.push(dia);

    if (valor2025EnPuntoActual !== null && val25 !== null) {
      const delta2025 = val25 - valor2025EnPuntoActual;
      proyeccion.push(Math.max(0, Math.round(valorActual2026 + delta2025)));
    } else {
      const xProyectado = puntosBase + (ultimoDia - 1 - dia);
      proyeccion.push(Math.max(0, Math.round(m * xProyectado + bLin)));
    }
  }

  return { labels, proyeccion, serie2025Futuro };
}

function generarComparativa(
  codigoCrm2026: string,
  metrica: string,
  extraDias = 0,
  codigoCrm2025Seleccionado: string | null = null
): Comparativa | null {
  const prog2026 = DataService.getPrograma(codigoCrm2026, 2026);
  if (!prog2026) return null;

  const inaug2026 = prog2026[CONFIG.campos.inauguracion] as string;
  if (!inaug2026) return null;

  const codigoCrm2025 = codigoCrm2025Seleccionado || DataService.buscarPar(codigoCrm2026);
  const prog2025 = codigoCrm2025 ? DataService.getPrograma(codigoCrm2025, 2025) : null;
  const inaug2025 = prog2025 ? (prog2025[CONFIG.campos.inauguracion] as string) : null;

  const metricas2026 = enriquecerConDiasRelativos(
    DataService.getMetricas(codigoCrm2026, 2026), inaug2026, extraDias
  );
  const metricas2025 = (codigoCrm2025 && prog2025 && inaug2025)
    ? enriquecerConDiasRelativos(DataService.getMetricas(codigoCrm2025, 2025), inaug2025, extraDias)
    : [];

  const alineado = alinearSeries(metricas2026, metricas2025, metrica, extraDias);
  const proyeccionResult = proyectar(metricas2026, metricas2025, metrica, 14, extraDias);

  const ultimoIdx = alineado.serie2026.length - 1;
  const actual2026 = ultimoIdx >= 0 ? (alineado.serie2026[ultimoIdx] ?? 0) : 0;
  let equivalente2025: number | null = null;
  for (let i = ultimoIdx; i >= 0; i--) {
    if (alineado.serie2025[i] != null) { equivalente2025 = alineado.serie2025[i]; break; }
  }
  const diasParaInaug = ultimoIdx >= 0 ? alineado.labels[ultimoIdx] : null;

  return {
    programa2026: {
      codigo: codigoCrm2026,
      nombre: (prog2026['programa.nombre'] || codigoCrm2026) as string,
      inauguracion: inaug2026,
    },
    programa2025: {
      codigo: codigoCrm2025 || 'Sin par 2025',
      nombre: prog2025 ? ((prog2025['programa.nombre'] || codigoCrm2025) as string) : 'Sin par 2025',
      inauguracion: inaug2025 || null,
      sinPar: !codigoCrm2025 || !prog2025 || !inaug2025,
    },
    alineado,
    proyeccion: proyeccionResult,
    kpis: {
      actual2026,
      equivalente2025,
      diferencia: equivalente2025 != null ? actual2026 - equivalente2025 : null,
      diasParaInaug,
    },
  };
}

function agregarMetricasPorDia(
  listaCodigos: { codigo: string; inauguracion: string }[],
  anio: number,
  metrica: string,
  inaugReferencia: string,
  extraDias = 0
): DataRow[] {
  const seriesPorPrograma: Map<number, number>[] = [];
  const todosLosDias = new Set<number>();

  listaCodigos.forEach(({ codigo, inauguracion }) => {
    const metricas = DataService.getMetricas(codigo, anio);
    const serieProg = new Map<number, number>();

    metricas.forEach(fila => {
      const fecha = fila[CONFIG.campos.fecha] as string;
      const diasPropios = diasParaInauguracion(fecha, inauguracion);
      if (diasPropios === null || diasPropios < -extraDias) return;

      const diaRef = diasParaInauguracion(fecha, inaugReferencia);
      if (diaRef === null || diaRef < -extraDias) return;

      const val = leerMetrica(fila, metrica);
      serieProg.set(diaRef, val);
      todosLosDias.add(diaRef);
    });

    if (serieProg.size > 0) seriesPorPrograma.push(serieProg);
  });

  const diasOrdenados = [...todosLosDias].sort((a, b) => b - a);

  const acumulado = new Map<number, number>();
  const ultimoValor = new Array(seriesPorPrograma.length).fill(0);

  diasOrdenados.forEach(dia => {
    let suma = 0;
    seriesPorPrograma.forEach((serieProg, idx) => {
      if (serieProg.has(dia)) {
        ultimoValor[idx] = serieProg.get(dia)!;
      }
      suma += ultimoValor[idx];
    });
    acumulado.set(dia, suma);
  });

  const def = CONFIG.metricas[metrica];
  return diasOrdenados.map(dia => {
    const suma = acumulado.get(dia)!;
    const fila: DataRow = { dias_para_inaug: dia };
    if (def) {
      def.campos.forEach((c, i) => { fila[c] = i === 0 ? suma : 0; });
    } else {
      fila[metrica] = suma;
    }
    return fila;
  });
}

function generarComparativaMultiple(codigos2026: string[], metrica: string, extraDias = 0): Comparativa | null {
  const pares: any[] = [];
  const lista2026Completa: { codigo: string; inauguracion: string; nombre: string }[] = [];

  codigos2026.forEach(cod26 => {
    const prog26 = DataService.getPrograma(cod26, 2026);
    if (!prog26) return;
    const inaug26 = prog26[CONFIG.campos.inauguracion] as string;
    if (!inaug26) return;
    lista2026Completa.push({ codigo: cod26, inauguracion: inaug26, nombre: (prog26['programa.nombre'] || cod26) as string });

    const cod25 = DataService.buscarPar(cod26);
    if (!cod25) return;
    const prog25 = DataService.getPrograma(cod25, 2025);
    if (!prog25) return;
    const inaug25 = prog25[CONFIG.campos.inauguracion] as string;
    if (!inaug25) return;
    pares.push({
      codigo2026: cod26, inauguracion2026: inaug26,
      codigo2025: cod25, inauguracion2025: inaug25,
      nombre2026: (prog26['programa.nombre'] || cod26) as string,
      nombre2025: (prog25['programa.nombre'] || cod25) as string,
    });
  });

  if (lista2026Completa.length === 0) return null;

  const maxInaug2026 = lista2026Completa
    .map(p => p.inauguracion)
    .sort((a, b) => b.localeCompare(a))[0];

  const maxInaug2025 = pares.length > 0
    ? pares.map((p: any) => p.inauguracion2025 as string).sort((a: string, b: string) => b.localeCompare(a))[0]
    : null;

  const lista2026 = lista2026Completa.map(p => ({ codigo: p.codigo, inauguracion: p.inauguracion }));
  const lista2025 = pares.map((p: any) => ({ codigo: p.codigo2025 as string, inauguracion: p.inauguracion2025 as string }));

  const metricasAgregadas2026 = agregarMetricasPorDia(lista2026, 2026, metrica, maxInaug2026, extraDias);
  const metricasAgregadas2025 = pares.length > 0
    ? agregarMetricasPorDia(lista2025, 2025, metrica, maxInaug2025!, extraDias)
    : [];

  const alineado = alinearSeries(metricasAgregadas2026, metricasAgregadas2025, metrica, extraDias);
  const proyeccionResult = proyectar(metricasAgregadas2026, metricasAgregadas2025, metrica, 14, extraDias);

  const ultimoIdx = alineado.serie2026.length - 1;
  const actual2026 = ultimoIdx >= 0 ? (alineado.serie2026[ultimoIdx] ?? 0) : 0;
  let equivalente2025: number | null = null;
  for (let i = ultimoIdx; i >= 0; i--) {
    if (alineado.serie2025[i] != null) { equivalente2025 = alineado.serie2025[i]; break; }
  }
  const diasParaInaug = ultimoIdx >= 0 ? alineado.labels[ultimoIdx] : null;

  return {
    programa2026: {
      codigo: lista2026Completa.length === 1 ? lista2026Completa[0].codigo : `${lista2026Completa.length} programas`,
      nombre: lista2026Completa.length === 1 ? lista2026Completa[0].nombre : `${lista2026Completa.length} programas agregados`,
      inauguracion: maxInaug2026,
    },
    programa2025: {
      codigo: pares.length === 1 ? pares[0].codigo2025 : (pares.length > 0 ? `${pares.length} pares` : 'Sin par 2025'),
      nombre: pares.length === 1 ? pares[0].nombre2025 : (pares.length > 0 ? `${pares.length} pares agregados` : 'Sin par 2025'),
      inauguracion: maxInaug2025 || null,
      sinPar: pares.length === 0,
    },
    alineado,
    proyeccion: proyeccionResult,
    kpis: {
      actual2026,
      equivalente2025,
      diferencia: equivalente2025 != null ? actual2026 - equivalente2025 : null,
      diasParaInaug,
    },
    programasIncluidos: lista2026Completa.length,
    paresIncluidos: pares.length,
  };
}

const CompareEngine = {
  diasParaInauguracion,
  enriquecerConDiasRelativos,
  alinearSeries,
  proyectar,
  generarComparativa,
  generarComparativaMultiple,
};

export default CompareEngine;
