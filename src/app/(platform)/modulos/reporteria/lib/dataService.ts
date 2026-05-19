import Papa from 'papaparse';
import CONFIG from './config';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DataRow = Record<string, any>;

interface Store {
  datamart2025: DataRow[];
  datamart2026: DataRow[];
  programas2025: DataRow[];
  programas2026: DataRow[];
  pares: DataRow[];
}

const store: Store = {
  datamart2025: [],
  datamart2026: [],
  programas2025: [],
  programas2026: [],
  pares: [],
};

function normalizarFecha(fechaStr: string | null): string | null {
  if (!fechaStr) return null;
  return fechaStr.replace(/\//g, '-');
}

function fetchCSV(url: string): Promise<DataRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data as DataRow[]),
      error: (err: Error) => reject(err),
    });
  });
}

function normalizarDatamart(filas: DataRow[]): DataRow[] {
  const campoFecha = CONFIG.campos.fecha;
  return filas.map(fila => {
    fila[campoFecha] = normalizarFecha(fila[campoFecha]);
    return fila;
  });
}

function normalizarProgramas(filas: DataRow[]): DataRow[] {
  const camposDate = [
    'programa.fecha_inicio', 'programa.fecha_inauguracion',
    'programa.fecha_inauguracion_bp', 'programa.inicio_campaing', 'programa.fin_campaing',
  ];
  return filas.map(fila => {
    camposDate.forEach(c => {
      if (fila[c]) fila[c] = normalizarFecha(fila[c]);
    });
    return fila;
  });
}

async function cargarTodo(): Promise<Store> {
  const [dm25, dm26, pares, prog25, prog26] = await Promise.all([
    fetchCSV(CONFIG.urls.datamart2025),
    fetchCSV(CONFIG.urls.datamart2026),
    fetchCSV(CONFIG.urls.pares),
    fetchCSV(CONFIG.urls.programas2025),
    fetchCSV(CONFIG.urls.programas2026),
  ]);

  store.datamart2025 = normalizarDatamart(dm25);
  store.datamart2026 = normalizarDatamart(dm26);
  store.pares = pares;
  store.programas2025 = normalizarProgramas(prog25);
  store.programas2026 = normalizarProgramas(prog26);

  return store;
}

function getParesValidos() {
  return store.pares
    .filter(p => {
      const cod25 = (p['Programa2025'] || '').trim();
      return cod25 && !CONFIG.sinPar.includes(cod25);
    })
    .map(p => ({
      codigo2026: p['Programa2026'],
      nombre2026: p['Nombre'] || '',
      codigo2025: p['Programa2025'],
      nombre2025: '',
    }));
}

function buscarPar(codigoCrm2026: string): string | null {
  const par = store.pares.find(p => p['Programa2026'] === codigoCrm2026);
  if (!par) return null;
  const cod25 = (par['Programa2025'] || '').trim();
  if (CONFIG.sinPar.includes(cod25)) return null;
  return cod25;
}

function getMetricas(codigoCrm: string, anio: number): DataRow[] {
  const source = anio === 2025 ? store.datamart2025 : store.datamart2026;
  return source
    .filter(f => f[CONFIG.campos.codigoCrm] === codigoCrm)
    .sort((a, b) => (a[CONFIG.campos.fecha] as string).localeCompare(b[CONFIG.campos.fecha] as string));
}

function getPrograma(codigoCrm: string, anio: number): DataRow | null {
  const source = anio === 2025 ? store.programas2025 : store.programas2026;
  return source.find(p => p[CONFIG.campos.codigoCrm] === codigoCrm) || null;
}

function getValoresUnicos(campo: string): string[] {
  const valores = new Set<string>();
  store.programas2026.forEach(p => {
    const val = (p[campo] || '').trim();
    if (val) valores.add(val);
  });
  return [...valores].sort((a, b) => a.localeCompare(b));
}

const EXCLUIR_NOMBRE = ['edex', 'analista', 'analistas'];

function getProgramas2026ConPar(filtros?: Record<string, string[]>): { codigo: string; nombre: string }[] {
  return store.programas2026
    .filter(p => {
      const nombre = (p['programa.nombre'] || '').toLowerCase();
      if (EXCLUIR_NOMBRE.some(w => nombre.includes(w))) return false;
      if (filtros) {
        for (const [campo, valores] of Object.entries(filtros)) {
          if (valores.length === 0) continue;
          const val = (p[campo] || '').trim();
          if (!valores.includes(val)) return false;
        }
      }
      return true;
    })
    .map(p => ({
      codigo: p[CONFIG.campos.codigoCrm] as string,
      nombre: (p['programa.nombre'] || p[CONFIG.campos.codigoCrm]) as string,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function getValoresUnicosFiltrados(campo: string, filtros: Record<string, string[]>): string[] {
  const valores = new Set<string>();
  store.programas2026
    .filter(p => {
      if (filtros) {
        for (const [fc, vals] of Object.entries(filtros)) {
          if (fc === campo) continue;
          if (vals.length === 0) continue;
          const val = (p[fc] || '').trim();
          if (!vals.includes(val)) return false;
        }
      }
      return true;
    })
    .forEach(p => {
      const val = (p[campo] || '').trim();
      if (val) valores.add(val);
    });
  return [...valores].sort((a, b) => a.localeCompare(b));
}

const DataService = {
  cargarTodo,
  getParesValidos,
  buscarPar,
  getMetricas,
  getPrograma,
  getValoresUnicos,
  getValoresUnicosFiltrados,
  getProgramas2026ConPar,
  get store() { return store; },
};

export default DataService;
