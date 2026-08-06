import React, { useState, useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { CollapsibleSection } from './TestShellRenderer';
import {
  PLATES_DEF,
  PALETTE,
  toHex,
  needsDarkText,
  formatConc
} from '../data/constants';

const clampDim = (value, fallback) => {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return fallback;
  return Math.max(1, Math.min(100, n));
};

const rowLabel = (idx) => {
  let label = '';
  let n = idx + 1;

  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }

  return label;
};

const buildGrid = (rows, cols, oldGrid) => {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => oldGrid?.[r]?.[c] ?? '')
  );
};

const buildCellConfig = (rows, cols, oldCellConfig) => {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      oldCellConfig?.[r]?.[c]
        ? { ...oldCellConfig[r][c] }
        : {
            excluded: false,
            role: null,
            conc: null,
            region: 'Primary',
            manualOverride: false
          }
    )
  );
};

const toNumber = (v) => {
  const n = parseFloat(typeof v === 'string' ? v.trim().replace(',', '.') : v);
  return isNaN(n) ? NaN : n;
};

const operatorLabel = (op) => {
  if (!op) return '';
  if (typeof op === 'string') return op;
  return op.name || op.label || '';
};

const normalizeMoleculeList = (molecules) => {
  if (!Array.isArray(molecules)) return [];

  return molecules.map((m, idx) => {
    if (typeof m === 'string') {
      return {
        id: m,
        name: m,
        atoms: []
      };
    }

    return {
      id: m?.id || `mol_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      name: m?.name || `Molecule ${idx + 1}`,
      atoms: Array.isArray(m?.atoms)
        ? m.atoms.map((a) => String(a).trim()).filter(Boolean)
        : []
    };
  });
};

const hashString = (str) => {
  return String(str || '')
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
};

export const NMRFittingsTestRenderer = ({
  activeTest,
  updateActiveTest,
  TestHeader,
  operators = [],
  molecules = [],
  allCmpds = [],
  customConc = {},
  setCustomConc,
  cmpColors = {},
  setCmpColors,
  setCustomCmpds,
  testCategories = []
}) => {
  const updateTest = (patch) => {
    if (updateActiveTest) updateActiveTest(patch);
  };

  const moleculeList = useMemo(
    () => normalizeMoleculeList(molecules),
    [molecules]
  );

  const gridPreset = activeTest.gridPreset || '96';
  const presetDim = PLATES_DEF[gridPreset] || { rows: 8, cols: 12 };

  const rows = clampDim(
    activeTest.rowsStr ?? activeTest.rows ?? presetDim.rows,
    presetDim.rows
  );

  const cols = clampDim(
    activeTest.colsStr ?? activeTest.cols ?? presetDim.cols,
    presetDim.cols
  );

  const rawGrid = Array.isArray(activeTest.grid) ? activeTest.grid : [];
  const rawCellConfig = Array.isArray(activeTest.cellConfig)
    ? activeTest.cellConfig
    : [];

  const grid = useMemo(
    () => buildGrid(rows, cols, rawGrid),
    [rows, cols, rawGrid]
  );

  const cellConfig = useMemo(
    () => buildCellConfig(rows, cols, rawCellConfig),
    [rows, cols, rawCellConfig]
  );

  const ROWS = useMemo(
    () => Array.from({ length: rows }, (_, i) => rowLabel(i)),
    [rows]
  );

  const COLS = useMemo(
    () => Array.from({ length: cols }, (_, i) => i + 1),
    [cols]
  );

  const selectedMolecule =
    moleculeList.find(
      (m) =>
        m.id === activeTest.moleculeId ||
        m.name === activeTest.moleculeId ||
        m.name === activeTest.moleculeName
    ) || null;

  const atomOptions = selectedMolecule?.atoms || [];

  const identityOptions = useMemo(() => {
    return [...new Set([...(allCmpds || []), ...atomOptions])];
  }, [allCmpds, atomOptions]);

  const [mode, setMode] = useState('select'); // select | paint
  const [paintIdentity, setPaintIdentity] = useState('');
  const [isPainting, setIsPainting] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [customConcDraft, setCustomConcDraft] = useState({
    identity: '',
    top: '',
    dil: ''
  });

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const selectedValid =
    selectedCell &&
    selectedCell.r >= 0 &&
    selectedCell.r < rows &&
    selectedCell.c >= 0 &&
    selectedCell.c < cols;

  const selectedCfg = selectedValid
    ? cellConfig[selectedCell.r]?.[selectedCell.c]
    : null;

  /* Keep stored grid/cellConfig synchronized with current rows/cols */
  useEffect(() => {
    const badGrid =
      !Array.isArray(activeTest.grid) ||
      activeTest.grid.length !== rows ||
      activeTest.grid.some(
        (row) => !Array.isArray(row) || row.length !== cols
      );

    const badCell =
      !Array.isArray(activeTest.cellConfig) ||
      activeTest.cellConfig.length !== rows ||
      activeTest.cellConfig.some(
        (row) => !Array.isArray(row) || row.length !== cols
      );

    const badDims =
      String(activeTest.rows) !== String(rows) ||
      String(activeTest.cols) !== String(cols) ||
      String(activeTest.rowsStr) !== String(rows) ||
      String(activeTest.colsStr) !== String(cols);

    if (badGrid || badCell || badDims) {
      updateTest({
        rows,
        cols,
        rowsStr: String(rows),
        colsStr: String(cols),
        grid,
        cellConfig
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, grid, cellConfig, activeTest.grid, activeTest.cellConfig]);

  useEffect(() => {
    const handleMouseUp = () => setIsPainting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const identityColor = (name) => {
    if (!name) return '#ffffff';

    const stored = cmpColors?.[name];
    if (stored && /^#[0-9a-f]{6}$/i.test(stored)) {
      return stored.toLowerCase();
    }

    const idx = identityOptions.indexOf(name);
    const safeIdx =
      idx >= 0 ? idx : hashString(name) % Math.max(1, PALETTE.length);

    return toHex(PALETTE[safeIdx % PALETTE.length]);
  };

  const getIdentity = (r, c) => {
    return cellConfig[r]?.[c]?.role || null;
  };

  const isControlIdentity = (name) => {
    return ['cells', 'medium', 'pbs'].includes(String(name).toLowerCase());
  };

  const concOf = (r, c, identityArg) => {
    const identity =
      identityArg !== undefined ? identityArg : getIdentity(r, c);

    if (!identity || isControlIdentity(identity)) return 0;

    const cfg = cellConfig[r]?.[c];

    if (
      cfg &&
      cfg.conc !== null &&
      cfg.conc !== undefined &&
      cfg.conc !== ''
    ) {
      const manual = parseFloat(String(cfg.conc).replace(',', '.'));
      if (!isNaN(manual)) return manual;
    }

    const custom = customConc?.[identity] || {};

    const topRaw =
      custom.top !== undefined ? custom.top : activeTest.topConcStr;
    const dilRaw =
      custom.dil !== undefined ? custom.dil : activeTest.dilFactorStr;

    const top = parseFloat(String(topRaw || '').replace(',', '.')) || 0;
    const dil = parseFloat(String(dilRaw || '').replace(',', '.')) || 1;

    if (top <= 0 || dil <= 0) return 0;

    let step = 0;

    for (let i = 0; i < c; i++) {
      if (getIdentity(r, i) === identity) step++;
    }

    return top / Math.pow(dil, step);
  };

  const updateGridValue = (r, c, value) => {
    const nextGrid = grid.map((row) => [...row]);
    nextGrid[r][c] = value;
    updateTest({ grid: nextGrid });
  };

  const updateCellCfg = (r, c, patch) => {
    const nextCell = cellConfig.map((row) =>
      row.map((cell) => ({ ...cell }))
    );

    nextCell[r][c] = {
      ...nextCell[r][c],
      ...patch
    };

    updateTest({ cellConfig: nextCell });
  };

  const assignIdentity = (r, c, identity) => {
    const clean = (identity || '').trim();

    updateCellCfg(r, c, {
      role: clean || null,
      manualOverride: !!clean,
      conc: null
    });

    if (
      clean &&
      !identityOptions.includes(clean) &&
      !atomOptions.includes(clean) &&
      setCustomCmpds
    ) {
      setCustomCmpds((prev) => [...(Array.isArray(prev) ? prev : []), clean]);
    }
  };

  const handleMapMouseDown = (r, c) => {
    if (mode === 'paint' && paintIdentity) {
      setIsPainting(true);
      assignIdentity(r, c, paintIdentity);
    } else {
      setSelectedCell({ r, c });
    }
  };

  const handleMapMouseEnter = (r, c) => {
    if (mode === 'paint' && isPainting && paintIdentity) {
      assignIdentity(r, c, paintIdentity);
    }
  };

  const applyPreset = (preset) => {
    if (preset === 'custom') {
      updateTest({ gridPreset: 'custom' });
      return;
    }

    const dim = PLATES_DEF[preset] || { rows: 8, cols: 12 };

    updateTest({
      gridPreset: preset,
      plateType: preset,
      rows: dim.rows,
      cols: dim.cols,
      rowsStr: String(dim.rows),
      colsStr: String(dim.cols),
      grid: buildGrid(dim.rows, dim.cols, grid),
      cellConfig: buildCellConfig(dim.rows, dim.cols, cellConfig)
    });
  };

  const commitCustomSize = (nextRows, nextCols) => {
    const r = clampDim(nextRows, rows);
    const c = clampDim(nextCols, cols);

    updateTest({
      gridPreset: 'custom',
      plateType: 'custom',
      rows: r,
      cols: c,
      rowsStr: String(r),
      colsStr: String(c),
      grid: buildGrid(r, c, grid),
      cellConfig: buildCellConfig(r, c, cellConfig)
    });
  };

  const addCustomConc = () => {
    if (!setCustomConc) return;

    const identity = customConcDraft.identity;
    const top = parseFloat(String(customConcDraft.top).replace(',', '.'));
    const dil =
      parseFloat(String(customConcDraft.dil).replace(',', '.')) || 1;

    if (!identity || isNaN(top) || top <= 0 || dil <= 0) {
      alert('Please choose an identity and enter a valid top concentration.');
      return;
    }

    setCustomConc({
      ...(customConc || {}),
      [identity]: { top, dil }
    });

    setCustomConcDraft((prev) => ({
      ...prev,
      top: '',
      dil: ''
    }));
  };

  const removeCustomConc = (identity) => {
    if (!setCustomConc) return;

    const next = { ...(customConc || {}) };
    delete next[identity];
    setCustomConc(next);
  };

  const applyImportedMatrix = (rawAoa) => {
    if (!Array.isArray(rawAoa) || rawAoa.length === 0) return;

    const aoa = rawAoa.filter(
      (row) =>
        Array.isArray(row) && row.some((v) => String(v ?? '').trim() !== '')
    );

    if (!aoa.length) return;

    const first = aoa[0] || [];

    let hasHeader = false;
    let hasRowLabels = false;

    if (
      first.length &&
      (String(first[0]).trim() === '' || /r\c|row|well/i.test(String(first[0])))
    ) {
      hasHeader = true;
      hasRowLabels = true;
    }

    const body = hasHeader ? aoa.slice(1) : aoa;

    if (
      body.length &&
      body.every(
        (row) =>
          row.length &&
          String(row[0]).trim() !== '' &&
          isNaN(parseFloat(String(row[0]).replace(',', '.')))
      )
    ) {
      hasRowLabels = true;
    }

    const importedRows = body.length;

    const importedCols = body.reduce((max, row) => {
      const effective = row.length - (hasRowLabels ? 1 : 0);
      return Math.max(max, effective);
    }, 0);

    const targetRows = Math.max(rows, importedRows);
    const targetCols = Math.max(cols, importedCols);

    const nextGrid = buildGrid(targetRows, targetCols, grid);
    const nextCell = buildCellConfig(targetRows, targetCols, cellConfig);

    body.forEach((row, r) => {
      if (r >= targetRows) return;

      row.forEach((val, c) => {
        if (hasRowLabels && c === 0) return;

        const targetC = hasRowLabels ? c - 1 : c;
        if (targetC < 0 || targetC >= targetCols) return;

        nextGrid[r][targetC] = String(val ?? '').trim();
      });
    });

    updateTest({
      grid: nextGrid,
      cellConfig: nextCell,
      rows: targetRows,
      cols: targetCols,
      rowsStr: String(targetRows),
      colsStr: String(targetCols),
      gridPreset:
        targetRows === rows && targetCols === cols
          ? gridPreset
          : 'custom',
      plateType:
        targetRows === rows && targetCols === cols
          ? gridPreset
          : 'custom'
    });
  };

  const importTextFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const firstLine = (text.split(/\r?\n/)[0] || '');

      const delimiter = firstLine.includes('\t')
        ? '\t'
        : firstLine.split(';').length > firstLine.split(',').length
        ? ';'
        : ',';

      const rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => line.split(delimiter).map((x) => x.trim()));

      applyImportedMatrix(rows);
    } catch (err) {
      console.error(err);
      alert('Text import failed: ' + err.message);
    }

    e.target.value = '';
  };

  const importExcelFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const aoa = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: ''
      });

      applyImportedMatrix(aoa);
    } catch (err) {
      console.error(err);
      alert('Excel import failed: ' + err.message);
    }

    e.target.value = '';
  };

  const exportXLS = () => {
    try {
      const wb = XLSX.utils.book_new();

      const rawAoa = [['', ...COLS]];

      ROWS.forEach((rl, r) => {
        rawAoa.push([
          rl,
          ...COLS.map((_, c) => {
            const v = grid[r]?.[c];
            const n = toNumber(v);

            if (v === '') return '';
            if (isNaN(n)) return String(v);
            return n;
          })
        ]);
      });

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(rawAoa),
        'Raw Data'
      );

      const mapAoa = [['', ...COLS]];

      ROWS.forEach((rl, r) => {
        mapAoa.push([
          rl,
          ...COLS.map((_, c) => {
            const identity = getIdentity(r, c);
            if (!identity) return '';

            const conc = concOf(r, c, identity);
            return conc > 0
              ? `${identity} @ ${formatConc(conc)} ${
                  activeTest.unit || 'a.u.'
                }`
              : identity;
          })
        ]);
      });

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(mapAoa),
        'Sample Map'
      );

      const summaryAoa = [['Identity', 'Type', 'Cells', 'Mean Raw Value']];

      identityOptions.forEach((identity) => {
        let count = 0;
        let sum = 0;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (getIdentity(r, c) !== identity) continue;

            count++;
            const n = toNumber(grid[r]?.[c]);
            if (!isNaN(n)) sum += n;
          }
        }

        if (count > 0) {
          summaryAoa.push([
            identity,
            atomOptions.includes(identity) ? 'Atom' : 'Compound',
            count,
            count ? (sum / count).toFixed(4) : ''
          ]);
        }
      });

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(summaryAoa),
        'Summary'
      );

      const fname = `NMR_Fittings_${(activeTest.name || 'test').replace(
        /[^a-z0-9]+/gi,
        '_'
      )}.xlsx`;

      XLSX.writeFile(wb, fname);
    } catch (err) {
      console.error(err);
      alert('Export failed: ' + err.message);
    }
  };

  const processedChart = useMemo(() => {
    const byIdentity = {};

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cfg = cellConfig[r]?.[c];
        if (!cfg || cfg.excluded) continue;

        const identity = cfg.role;
        if (!identity || isControlIdentity(identity)) continue;

        const value = toNumber(grid[r]?.[c]);
        if (isNaN(value)) continue;

        const conc = concOf(r, c, identity);
        if (!(conc > 0)) continue;

        if (!byIdentity[identity]) byIdentity[identity] = {};

        const key = conc.toPrecision(6);

        if (!byIdentity[identity][key]) {
          byIdentity[identity][key] = {
            x: Math.log10(conc),
            realX: conc,
            values: []
          };
        }

        byIdentity[identity][key].values.push(value);
      }
    }

    return Object.entries(byIdentity)
      .map(([identity, groups]) => {
        const data = Object.values(groups)
          .map((g) => ({
            x: g.x,
            realX: g.realX,
            y: g.values.reduce((s, v) => s + v, 0) / g.values.length
          }))
          .sort((a, b) => a.x - b.x);

        return {
          label: identity,
          color: identityColor(identity),
          data
        };
      })
      .filter((ds) => ds.data.length > 0);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    grid,
    cellConfig,
    rows,
    cols,
    customConc,
    activeTest.topConcStr,
    activeTest.dilFactorStr,
    identityOptions,
    cmpColors
  ]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'scatter',
      data: {
        datasets: processedChart.map((ds) => ({
          label: ds.label,
          data: ds.data,
          borderColor: ds.color,
          backgroundColor: ds.color,
          pointRadius: 5,
          showLine: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: {
              display: true,
              text: `Log₁₀ concentration (${activeTest.unit || 'a.u.'})`,
              font: { size: 14, weight: 'bold' },
              color: '#334155'
            },
            ticks: {
              color: '#64748b'
            }
          },
          y: {
            title: {
              display: true,
              text: `Raw value (${activeTest.valueUnit || 'a.u.'})`,
              font: { size: 14, weight: 'bold' },
              color: '#334155'
            },
            ticks: {
              color: '#64748b'
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              font: { size: 12, weight: 'bold' }
            }
          },
          tooltip: {
            callbacks: {
              title: (ctx) => {
                const logX = ctx[0].parsed.x;
                const realX = ctx[0].raw?.realX || Math.pow(10, logX);

                return `Conc: ${formatConc(realX)} ${
                  activeTest.unit || 'a.u.'
                }`;
              },
              label: (ctx) => {
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}`;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [processedChart, activeTest.unit, activeTest.valueUnit]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {TestHeader}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        <div
          id={`nmr-fittings-report-${activeTest.id}`}
          className="flex flex-col gap-6"
        >
          {/* TOOLBAR */}
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-end gap-3 no-print">
            <button
              onClick={exportXLS}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
            >
              📊 Export XLS
            </button>
          </div>

          {/* CLASSIFICATION */}
          <CollapsibleSection
            title="Classification"
            icon="🏷️"
            defaultOpen={true}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Operator
                </label>

                <select
                  value={activeTest.operator || ''}
                  onChange={(e) =>
                    updateTest({ operator: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="">— Select operator —</option>

                  {activeTest.operator &&
                    !(operators || [])
                      .map(operatorLabel)
                      .includes(activeTest.operator) && (
                      <option value={activeTest.operator}>
                        {activeTest.operator}
                      </option>
                    )}

                  {(operators || []).map((op, idx) => {
                    const name = operatorLabel(op);

                    return (
                      <option key={`${name}_${idx}`} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Molecule
                </label>

                <select
                  value={selectedMolecule?.id || activeTest.moleculeId || ''}
                  onChange={(e) => {
                    const selected = moleculeList.find(
                      (m) => m.id === e.target.value
                    );

                    updateTest({
                      moleculeId: selected?.id || '',
                      moleculeName: selected?.name || ''
                    });
                  }}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="">— Select molecule —</option>

                  {moleculeList.map((mol) => (
                    <option key={mol.id} value={mol.id}>
                      {mol.name}
                    </option>
                  ))}
                </select>

                {selectedMolecule && (
                  <div className="text-[10px] text-slate-500 mt-2">
                    Atoms: {selectedMolecule.atoms.join(', ') || 'None'}
                  </div>
                )}
              </div>

              <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Test Category
                </label>

                <input
                  type="text"
                  value={activeTest.testCategory || ''}
                  onChange={(e) =>
                    updateTest({ testCategory: e.target.value })
                  }
                  list={`nmr-fittings-category-options-${activeTest.id}`}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
                />

                <datalist
                  id={`nmr-fittings-category-options-${activeTest.id}`}
                >
                  {(testCategories || []).map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
            </div>
          </CollapsibleSection>

          {/* SETUP */}
          <CollapsibleSection
            title="NMR Fittings Setup"
            icon="⚙️"
            defaultOpen={true}
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-4 items-stretch">
                {/* Grid format */}
                <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2 flex-1 w-full md:min-w-[350px]">
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                    Grid Format
                  </div>

                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                        Preset
                      </label>

                      <select
                        value={gridPreset}
                        onChange={(e) => applyPreset(e.target.value)}
                        className="border border-blue-300 text-blue-700 font-bold rounded-lg p-1.5 w-44 text-xs bg-blue-50 cursor-pointer outline-none"
                      >
                        <option value="96">96</option>
                        <option value="48">48</option>
                        <option value="24">24</option>
                        <option value="12">12</option>
                        <option value="6">6</option>
                        <option value="1">1</option>
                        <option value="custom">Custom rows/cols</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                        Rows
                      </label>

                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={activeTest.rowsStr ?? rows}
                        onChange={(e) =>
                          updateTest({
                            rowsStr: e.target.value,
                            gridPreset: 'custom'
                          })
                        }
                        onBlur={(e) =>
                          commitCustomSize(e.target.value, cols)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur();
                        }}
                        className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                        Columns
                      </label>

                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={activeTest.colsStr ?? cols}
                        onChange={(e) =>
                          updateTest({
                            colsStr: e.target.value,
                            gridPreset: 'custom'
                          })
                        }
                        onBlur={(e) =>
                          commitCustomSize(rows, e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur();
                        }}
                        className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Units and concentration series */}
                <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2 flex-1 w-full md:min-w-[350px]">
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                    Concentration Series
                  </div>

                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                        Concentration Unit
                      </label>

                      <select
                        value={activeTest.unit || 'µM'}
                        onChange={(e) => updateTest({ unit: e.target.value })}
                        className="border border-slate-300 rounded-lg p-1.5 w-28 text-xs bg-white font-bold text-slate-800 outline-none"
                      >
                        <option value="µM">µM</option>
                        <option value="µg/mL">µg/mL</option>
                        <option value="nM">nM</option>
                        <option value="mM">mM</option>
                        <option value="a.u.">a.u.</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                        Top Conc
                      </label>

                      <input
                        type="number"
                        step="0.1"
                        value={activeTest.topConcStr || ''}
                        onChange={(e) =>
                          updateTest({ topConcStr: e.target.value })
                        }
                        className="border border-slate-300 rounded-lg p-1.5 w-24 text-xs outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                        Dil. Factor
                      </label>

                      <input
                        type="number"
                        step="0.1"
                        value={activeTest.dilFactorStr || ''}
                        onChange={(e) =>
                          updateTest({ dilFactorStr: e.target.value })
                        }
                        className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-500">
                    Concentrations are inferred from identical identities in
                    the same row, unless a manual concentration is set for a
                    cell.
                  </div>
                </div>
              </div>

              {/* Custom concentrations */}
              <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                  Custom Concentrations
                </div>

                <div className="flex flex-wrap gap-2 items-end">
                  <select
                    value={customConcDraft.identity}
                    onChange={(e) =>
                      setCustomConcDraft((prev) => ({
                        ...prev,
                        identity: e.target.value
                      }))
                    }
                    className="border border-slate-300 rounded-lg p-1.5 text-xs w-48 bg-white outline-none"
                  >
                    <option value="">Identity…</option>

                    <optgroup label="Compounds">
                      {(allCmpds || []).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </optgroup>

                    {atomOptions.length > 0 && (
                      <optgroup
                        label={`Atoms (${
                          selectedMolecule?.name || 'molecule'
                        })`}
                      >
                        {atomOptions.map((atom) => (
                          <option key={atom} value={atom}>
                            {atom}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  <input
                    type="number"
                    value={customConcDraft.top}
                    onChange={(e) =>
                      setCustomConcDraft((prev) => ({
                        ...prev,
                        top: e.target.value
                      }))
                    }
                    className="border border-slate-300 rounded-lg p-1.5 w-24 text-xs outline-none"
                    placeholder="Top"
                  />

                  <input
                    type="number"
                    value={customConcDraft.dil}
                    onChange={(e) =>
                      setCustomConcDraft((prev) => ({
                        ...prev,
                        dil: e.target.value
                      }))
                    }
                    className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none"
                    placeholder="Dil"
                  />

                  <button
                    onClick={addCustomConc}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm"
                  >
                    Set
                  </button>
                </div>

                {Object.keys(customConc || {}).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(customConc).map(([identity, settings]) => (
                      <span
                        key={identity}
                        className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 font-bold shadow-sm"
                      >
                        {identity}: {settings.top} ÷ {settings.dil}
                        <button
                          onClick={() => removeCustomConc(identity)}
                          className="text-red-500 hover:text-red-700 font-black"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* SAMPLE MAP */}
          <CollapsibleSection
            title="Sample Map"
            icon="🧭"
            defaultOpen={true}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3 no-print">
                <div className="flex bg-slate-200 p-1 rounded-lg shadow-inner">
                  {[
                    ['select', '👁️ Select'],
                    ['paint', '🖌️ Paint']
                  ].map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setIsPainting(false);
                      }}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                        mode === m
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === 'paint' && (
                  <div className="flex items-center gap-2">
                    <select
                      value={paintIdentity}
                      onChange={(e) => setPaintIdentity(e.target.value)}
                      className="border border-blue-300 rounded-lg p-1.5 text-xs bg-white outline-none focus:border-blue-500 min-w-[180px]"
                    >
                      <option value="">— Select identity —</option>

                      <optgroup label="Compounds">
                        {(allCmpds || []).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>

                      {atomOptions.length > 0 && (
                        <optgroup
                          label={`Atoms (${
                            selectedMolecule?.name || 'molecule'
                          })`}
                        >
                          {atomOptions.map((atom) => (
                            <option key={atom} value={atom}>
                              {atom}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    {paintIdentity && (
                      <span
                        className="w-4 h-4 rounded-full border border-slate-300 inline-block"
                        style={{
                          backgroundColor: identityColor(paintIdentity)
                        }}
                      />
                    )}

                    <button
                      onClick={() => setPaintIdentity('')}
                      className="text-[10px] text-slate-500 underline hover:text-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-auto select-none">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `2.2rem repeat(${cols}, minmax(2.2rem, 1fr))`,
                    gap: '4px'
                  }}
                >
                  <div />

                  {COLS.map((c) => (
                    <div
                      key={c}
                      className="text-center text-[10px] font-black text-slate-400"
                    >
                      {c}
                    </div>
                  ))}

                  {ROWS.map((rl, r) => (
                    <React.Fragment key={rl}>
                      <div className="text-[10px] font-black text-slate-400 flex items-center justify-center">
                        {rl}
                      </div>

                      {COLS.map((_, c) => {
                        const identity = getIdentity(r, c);
                        const cfg = cellConfig[r]?.[c] || {};
                        const bg = identity ? identityColor(identity) : '#ffffff';
                        const dark = needsDarkText(bg);
                        const conc = identity ? concOf(r, c, identity) : 0;

                        const isSelected =
                          selectedValid &&
                          selectedCell.r === r &&
                          selectedCell.c === c;

                        return (
                          <div
                            key={`${rl}-${c}`}
                            onMouseDown={() => handleMapMouseDown(r, c)}
                            onMouseEnter={() => handleMapMouseEnter(r, c)}
                            title={`${rl}${c + 1}${
                              identity ? ` | ${identity}` : ''
                            }${conc > 0 ? ` | ${formatConc(conc)}` : ''}`}
                            className={`min-h-[2.2rem] rounded-md border flex flex-col items-center justify-center px-1 py-0.5 text-center cursor-pointer transition-all ${
                              isSelected
                                ? 'border-blue-600 ring-2 ring-blue-300'
                                : cfg.excluded
                                ? 'border-red-300 opacity-40'
                                : 'border-slate-200'
                            }`}
                            style={{
                              backgroundColor: bg,
                              color: dark ? '#0f172a' : '#ffffff'
                            }}
                          >
                            <div className="text-[9px] font-bold leading-tight truncate max-w-full">
                              {identity || '–'}
                            </div>

                            {conc > 0 && (
                              <div className="text-[8px] opacity-90 truncate max-w-full">
                                {formatConc(conc)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {selectedValid && (
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                  <div className="text-xs font-black text-blue-800 uppercase mb-3">
                    Selected Cell: {rowLabel(selectedCell.r)}
                    {selectedCell.c + 1}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                        Identity
                      </label>

                      <select
                        value={selectedCfg?.role || ''}
                        onChange={(e) =>
                          assignIdentity(
                            selectedCell.r,
                            selectedCell.c,
                            e.target.value
                          )
                        }
                        className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
                      >
                        <option value="">— None —</option>

                        {selectedCfg?.role &&
                          !identityOptions.includes(selectedCfg.role) && (
                            <option value={selectedCfg.role}>
                              {selectedCfg.role}
                            </option>
                          )}

                        <optgroup label="Compounds">
                          {(allCmpds || []).map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </optgroup>

                        {atomOptions.length > 0 && (
                          <optgroup
                            label={`Atoms (${
                              selectedMolecule?.name || 'molecule'
                            })`}
                          >
                            {atomOptions.map((atom) => (
                              <option key={atom} value={atom}>
                                {atom}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                        Manual Concentration
                      </label>

                      <input
                        type="text"
                        value={selectedCfg?.conc ?? ''}
                        onChange={(e) =>
                          updateCellCfg(selectedCell.r, selectedCell.c, {
                            conc: e.target.value || null,
                            manualOverride: true
                          })
                        }
                        placeholder="Auto"
                        className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selectedCfg?.excluded}
                          onChange={(e) =>
                            updateCellCfg(selectedCell.r, selectedCell.c, {
                              excluded: e.target.checked,
                              manualOverride: true
                            })
                          }
                          className="w-4 h-4 accent-red-600"
                        />
                        Exclude from fitting
                      </label>
                    </div>

                    <div className="flex items-end justify-end">
                      <button
                        onClick={() =>
                          updateCellCfg(selectedCell.r, selectedCell.c, {
                            role: null,
                            conc: null,
                            excluded: false,
                            manualOverride: false
                          })
                        }
                        className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
                      >
                        Clear Cell
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* DATA TABLE */}
          <CollapsibleSection title="Data" icon="🔢" defaultOpen={true}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 no-print">
                <div className="text-[10px] text-slate-500">
                  Import values from TXT/CSV/TSV or Excel. Existing sample
                  identities are preserved.
                </div>

                <div className="flex items-center gap-2">
                  <label className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors cursor-pointer">
                    📥 TXT
                    <input
                      type="file"
                      accept=".txt,.csv,.tsv"
                      onChange={importTextFile}
                      className="hidden"
                    />
                  </label>

                  <label className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors cursor-pointer">
                    📊 Excel
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={importExcelFile}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="border border-slate-300 rounded-lg bg-white overflow-auto shadow-sm">
                <table className="w-full border-collapse table-fixed min-w-[700px]">
                  <thead>
                    <tr>
                      <th className="bg-slate-200 border border-slate-300 p-1 text-xs text-slate-600 w-10">
                        R\C
                      </th>

                      {COLS.map((col) => (
                        <th
                          key={col}
                          className="bg-slate-50 border border-slate-300 p-1"
                        >
                          <div className="text-[11px] text-slate-500 font-black">
                            {col}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {ROWS.map((rl, r) => (
                      <tr key={rl}>
                        <td className="bg-slate-100 border border-slate-300 font-black text-center text-xs text-slate-700">
                          {rl}
                        </td>

                        {COLS.map((_, c) => {
                          const cfg = cellConfig[r]?.[c] || {};
                          const value = grid[r]?.[c] ?? '';

                          return (
                            <td
                              key={c}
                              className={`border p-0 relative align-middle ${
                                cfg.excluded
                                  ? 'border-slate-300'
                                  : 'border-slate-200'
                              }`}
                            >
                              <input
                                type="text"
                                value={value}
                                onFocus={() => setSelectedCell({ r, c })}
                                onChange={(e) =>
                                  updateGridValue(r, c, e.target.value)
                                }
                                readOnly={!!cfg.excluded}
                                className={`w-full h-9 px-2 text-center text-xs font-medium outline-none bg-transparent relative z-10 ${
                                  cfg.excluded
                                    ? 'line-through text-slate-400'
                                    : 'text-slate-900'
                                }`}
                              />

                              {cfg.role && !cfg.excluded && (
                                <div
                                  className="absolute top-0 left-0 max-w-[85%] truncate text-[6.5px] leading-tight font-bold px-1 py-0.5 rounded-br pointer-events-none z-20 shadow-sm"
                                  style={{
                                    backgroundColor: identityColor(cfg.role),
                                    color: needsDarkText(identityColor(cfg.role))
                                      ? '#0f172a'
                                      : '#ffffff'
                                  }}
                                >
                                  {cfg.role}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CollapsibleSection>

          {/* FITTING PREVIEW */}
          <CollapsibleSection title="Fitting" icon="📐" defaultOpen={true}>
            <div className="flex flex-col gap-4">
              <div className="text-xs text-slate-500">
                This chart uses raw values against inferred or manual
                concentrations. Set a top concentration and dilution factor, or
                assign manual concentrations to cells.
              </div>

              {processedChart.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-8 text-center text-sm text-slate-400 italic">
                  No fitting data available yet.
                </div>
              ) : (
                <div className="h-[420px] bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                  <canvas ref={chartRef} />
                </div>
              )}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
};

export default NMRFittingsTestRenderer;
