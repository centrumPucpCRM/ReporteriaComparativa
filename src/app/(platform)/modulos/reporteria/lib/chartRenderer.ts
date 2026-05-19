import { Chart, registerables } from 'chart.js';
import CONFIG from './config';
import type { Comparativa } from './compareEngine';

Chart.register(...registerables);

let chartInstance: Chart | null = null;

export function renderizarChart(
  canvasEl: HTMLCanvasElement,
  compLeads: Comparativa | null,
  compMetrica: Comparativa,
  metricaLabel: string
) {
  const ctx = canvasEl.getContext('2d')!;
  const esPxq = CONFIG._modo === 'pxq';

  const fmtValor = (v: number | null | undefined) => {
    if (v == null) return '—';
    const base = Number(v).toLocaleString();
    return esPxq ? `S/ ${base}` : base;
  };

  if (chartInstance) {
    chartInstance.destroy();
  }

  function buildLookups(comp: Comparativa) {
    const realL2026 = new Map<number, number | null>();
    const realL2025 = new Map<number, number | null>();
    comp.alineado.labels.forEach((dia, i) => {
      realL2026.set(dia, comp.alineado.serie2026[i]);
      realL2025.set(dia, comp.alineado.serie2025[i]);
    });
    const proyL2026 = new Map<number, number>();
    const proyL2025 = new Map<number, number | null>();
    comp.proyeccion.labels.forEach((dia, i) => {
      proyL2026.set(dia, comp.proyeccion.proyeccion[i]);
      proyL2025.set(dia, comp.proyeccion.serie2025Futuro[i]);
    });
    return { realL2026, realL2025, proyL2026, proyL2025 };
  }

  const allLabels = new Set<number>();
  [compLeads, compMetrica].forEach(c => {
    if (!c) return;
    c.alineado.labels.forEach(d => allLabels.add(d));
    c.proyeccion.labels.forEach(d => allLabels.add(d));
  });
  const todosLabels = [...allLabels].sort((a, b) => b - a);

  let leadsReal2026: (number | null)[] | undefined,
      leadsReal2025: (number | null)[] | undefined,
      leadsProy: (number | null)[] | undefined;

  if (compLeads) {
    const lkLeads = buildLookups(compLeads);
    leadsReal2026 = todosLabels.map(d => lkLeads.realL2026.has(d) ? lkLeads.realL2026.get(d)! : null);
    leadsReal2025 = todosLabels.map(d => {
      if (lkLeads.realL2025.has(d)) return lkLeads.realL2025.get(d)!;
      if (lkLeads.proyL2025.has(d)) return lkLeads.proyL2025.get(d)!;
      return null;
    });
    leadsProy = todosLabels.map(d => lkLeads.proyL2026.has(d) ? lkLeads.proyL2026.get(d)! : null);

    if (compLeads.alineado.labels.length > 0 && compLeads.proyeccion.labels.length > 0) {
      const ultimoDia = compLeads.alineado.labels[compLeads.alineado.labels.length - 1];
      const idx = todosLabels.indexOf(ultimoDia);
      if (idx >= 0 && leadsReal2026[idx] !== null) leadsProy[idx] = leadsReal2026[idx];
    }
  }

  const lkMet = buildLookups(compMetrica);
  const metReal2026 = todosLabels.map(d => lkMet.realL2026.has(d) ? lkMet.realL2026.get(d)! : null);
  const metReal2025 = todosLabels.map(d => {
    if (lkMet.realL2025.has(d)) return lkMet.realL2025.get(d)!;
    if (lkMet.proyL2025.has(d)) return lkMet.proyL2025.get(d)!;
    return null;
  });
  const metProy = todosLabels.map(d => lkMet.proyL2026.has(d) ? lkMet.proyL2026.get(d)! : null);

  if (compMetrica.alineado.labels.length > 0 && compMetrica.proyeccion.labels.length > 0) {
    const ultimoDia = compMetrica.alineado.labels[compMetrica.alineado.labels.length - 1];
    const idx = todosLabels.indexOf(ultimoDia);
    if (idx >= 0 && metReal2026[idx] !== null) metProy[idx] = metReal2026[idx];
  }

  const inaugStr = (compLeads || compMetrica).programa2026.inauguracion || compMetrica.programa2026.inauguracion;
  const fechaInaug = new Date(inaugStr + 'T00:00:00');
  const fechasReales = todosLabels.map(dias => {
    const fecha = new Date(fechaInaug);
    fecha.setDate(fecha.getDate() - dias);
    return fecha;
  });

  const labelsDisplay = fechasReales.map((f, i) => {
    if (todosLabels[i] === 0) return 'Inaug.';
    const dd = String(f.getDate()).padStart(2, '0');
    const mm = String(f.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  });

  const metricaYAxisID = compLeads ? 'y2' : 'y';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const datasets: any[] = [];

  if (compLeads && leadsReal2026 && leadsReal2025 && leadsProy) {
    datasets.push(
      {
        label: 'Leads 2026 (real)', data: leadsReal2026,
        borderColor: CONFIG.colores.real2026, backgroundColor: CONFIG.colores.real2026 + '15',
        borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4,
        tension: 0.3, fill: false, spanGaps: false, yAxisID: 'y',
      },
      {
        label: 'Leads 2025 (real)', data: leadsReal2025,
        borderColor: CONFIG.colores.real2025, backgroundColor: CONFIG.colores.real2025 + '15',
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
        tension: 0.3, fill: false, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Leads 2026 (proyección)', data: leadsProy,
        borderColor: CONFIG.colores.proyeccion2026, backgroundColor: CONFIG.colores.proyeccion2026,
        borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4,
        tension: 0.3, fill: false, spanGaps: false, yAxisID: 'y',
      },
    );
  }

  datasets.push(
    {
      label: `${metricaLabel} 2026 (real)`, data: metReal2026,
      borderColor: CONFIG.colores2.real2026, backgroundColor: CONFIG.colores2.real2026 + '15',
      borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4,
      tension: 0.3, fill: false, spanGaps: false, yAxisID: metricaYAxisID,
    },
    {
      label: `${metricaLabel} 2025 (real)`, data: metReal2025,
      borderColor: CONFIG.colores2.real2025, backgroundColor: CONFIG.colores2.real2025 + '15',
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
      tension: 0.3, fill: false, spanGaps: true, yAxisID: metricaYAxisID,
    },
    {
      label: `${metricaLabel} 2026 (proyección)`, data: metProy,
      borderColor: CONFIG.colores2.proyeccion2026, backgroundColor: CONFIG.colores2.proyeccion2026,
      borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4,
      tension: 0.3, fill: false, spanGaps: false, yAxisID: metricaYAxisID,
    },
  );

  const maxMetrica = Math.max(
    ...[...metReal2026, ...metReal2025, ...metProy].filter((v): v is number => v !== null && v !== undefined)
  ) || 1;
  const y2Max = maxMetrica * 2;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scales: any = {
    x: {
      title: { display: true, text: 'Fecha' },
      grid: { display: false },
      ticks: {
        maxTicksLimit: 20,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: function(this: any, _val: any, index: number) {
          const totalTicks = this.chart.data.labels.length;
          const step = Math.max(1, Math.floor(totalTicks / 20));
          return index % step === 0 ? this.getLabelForValue(index) : '';
        },
      },
    },
  };

  if (compLeads) {
    scales.y = {
      type: 'linear', position: 'left',
      title: { display: true, text: 'Total Leads', color: CONFIG.colores.real2026 },
      beginAtZero: true, grid: { color: '#f3f4f6' },
      ticks: { color: CONFIG.colores.real2026 },
    };
    scales.y2 = {
      type: 'linear', position: 'right',
      title: { display: true, text: metricaLabel, color: CONFIG.colores2.real2026 },
      beginAtZero: true, max: y2Max, grid: { drawOnChartArea: false },
      ticks: { color: CONFIG.colores2.real2026 },
    };
  } else {
    scales.y = {
      type: 'linear', position: 'left',
      title: { display: true, text: metricaLabel, color: CONFIG.colores2.real2026 },
      beginAtZero: true, grid: { color: '#f3f4f6' },
      ticks: { color: CONFIG.colores2.real2026 },
    };
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: labelsDisplay, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx === undefined) return '';
              const dias = todosLabels[idx];
              const fecha = fechasReales[idx];
              const dd = String(fecha.getDate()).padStart(2, '0');
              const mm = String(fecha.getMonth() + 1).padStart(2, '0');
              const yyyy = fecha.getFullYear();
              if (dias === 0) return `Inauguración: ${dd}/${mm}/${yyyy}`;
              if (dias < 0) return `${dd}/${mm}/${yyyy} (${Math.abs(dias)}d post inauguración)`;
              return `${dd}/${mm}/${yyyy} (${dias}d para inauguración)`;
            },
            label: (ctxItem) => {
              const label = ctxItem.dataset?.label || '';
              return `${label}: ${fmtValor(ctxItem.parsed?.y)}`;
            },
          },
        },
      },
      scales,
    },
  });

  if (chartInstance?.options?.scales?.y && !compLeads) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chartInstance.options.scales.y as any).ticks.callback = (value: number) => fmtValor(value);
  }
  if (chartInstance?.options?.scales?.y2) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chartInstance.options.scales.y2 as any).ticks.callback = (value: number) => fmtValor(value);
  }
  chartInstance.update();
}

export function limpiarChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}
