export interface MetricaDef {
  label: string;
  campos: string[];
}

export interface ConfigType {
  urls: {
    alumnos: { datamart2025: string; datamart2026: string };
    pxq: { datamart2025: string; datamart2026: string };
    pares: string;
    programas2025: string;
    programas2026: string;
    datamart2025: string;
    datamart2026: string;
  };
  _modo: 'alumnos' | 'pxq';
  campos: { fecha: string; codigoCrm: string; inauguracion: string };
  colores: { real2026: string; real2025: string; proyeccion2026: string };
  colores2: { real2026: string; real2025: string; proyeccion2026: string };
  sinPar: string[];
  metricas: Record<string, MetricaDef>;
}

const CONFIG: ConfigType = {
  urls: {
    alumnos: {
      datamart2025: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/ComparativaProgramas/Datamark+-+Datamark2025.csv',
      datamart2026: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/ComparativaProgramas/Datamark+-+Datamark2026.csv',
    },
    pxq: {
      datamart2025: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/ComparativaProgramas/Datamark+-+Datamark2025_pxq.csv',
      datamart2026: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/ComparativaProgramas/Datamark+-+Datamark2026_pxq.csv',
    },
    pares: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/ComparativaProgramas/Datamark+-+Pares.csv',
    programas2025: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/Consolidado/2025/2025_programas_consolidado.csv',
    programas2026: 'https://area-comercial-proyectos.s3.us-east-1.amazonaws.com/Reporteria/Consolidado/2026/2026_programas_consolidado.csv',
    get datamart2025() { return (CONFIG._modo === 'pxq' ? this.pxq : this.alumnos).datamart2025; },
    get datamart2026() { return (CONFIG._modo === 'pxq' ? this.pxq : this.alumnos).datamart2026; },
  },

  _modo: 'alumnos',

  campos: {
    fecha: 'sistema.fecha',
    codigoCrm: 'programa.codigo_crm',
    inauguracion: 'programa.fecha_inauguracion',
  },

  colores: {
    real2026: '#1e40af',
    real2025: '#9333ea',
    proyeccion2026: 'rgba(30, 64, 175, 0.35)',
  },

  colores2: {
    real2026: '#059669',
    real2025: '#d97706',
    proyeccion2026: 'rgba(5, 150, 105, 0.35)',
  },

  sinPar: ['No tiene', '', '#N/A', 'No hay 2025'],

  metricas: {
    total_leads: {
      label: 'Total Leads',
      campos: ['programa.ctn_total_leads'],
    },
    total_oportunidades: {
      label: 'Total Oportunidades',
      campos: ['programa.ctn_total_oportunidades'],
    },
    matriculados: {
      label: 'Matriculados',
      campos: ['programa.ctn_6 - Matriculado', 'programa.ctn_7 - Cerrada Ganada'],
    },
    total_tuberia: {
      label: 'Total Tubería',
      campos: [
        'programa.ctn_2 - Interes',
        'programa.ctn_3 - Inscrito A Examen',
        'programa.ctn_4 - Examen',
        'programa.ctn_5 - Admitido',
        'programa.ctn_6 - Matriculado',
        'programa.ctn_7 - Cerrada Ganada',
      ],
    },
    total_convertidos: {
      label: 'Total Convertidos',
      campos: [
        'programa.ctn_2 - Interes',
        'programa.ctn_3 - Inscrito A Examen',
        'programa.ctn_4 - Examen',
        'programa.ctn_5 - Admitido',
        'programa.ctn_6 - Matriculado',
        'programa.ctn_7 - Cerrada Ganada',
        'programa.ctn_8 - Cerrada Perdida',
      ],
    },
  },
};

export function leerMetrica(fila: Record<string, string | number>, metricaKey: string): number {
  const def = CONFIG.metricas[metricaKey];
  if (!def) return parseFloat(String(fila[metricaKey])) || 0;
  return def.campos.reduce((sum, campo) => sum + (parseFloat(String(fila[campo])) || 0), 0);
}

export default CONFIG;
