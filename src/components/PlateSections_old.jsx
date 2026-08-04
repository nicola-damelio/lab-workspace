{/* ================= FITTING ================= */}
<CollapsibleSection title="Fitting" icon="📐" defaultOpen={true}>
  <div className="flex flex-col gap-6">

    {/* ===== ERROR MANAGEMENT (now contains Manual SD) ===== */}
    <CollapsibleSection title="Error Management" icon="⚠️" defaultOpen={false}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 items-stretch">

          {/* Data Normalization */}
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col gap-3 flex-1 min-w-[300px]">
            <div className="text-[10px] uppercase font-bold text-slate-500">
              Data Normalization
            </div>
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-600">100% Control:</label>
                <div className="flex items-center gap-1">
                  <select
                    value={ctrlType}
                    onChange={(e) => updatePlate({ ctrlType: e.target.value })}
                    className="border border-slate-300 rounded-md p-1.5 text-xs bg-white w-full outline-none"
                  >
                    <option value="none">Manual</option>
                    {allCmpds.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    onClick={autoCalcControl}
                    className="text-[10px] font-bold bg-indigo-100 hover:bg-indigo-200 text-indigo-800 px-2 py-1.5 rounded-md shadow-sm transition whitespace-nowrap"
                  >
                    🎯 Auto
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-600">Control OD:</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={ctrlODStr}
                    onChange={(e) => updatePlate({ ctrlODStr: e.target.value })}
                    className={`border border-slate-300 rounded-md p-1.5 w-full text-xs font-bold outline-none ${
                      ctrlType !== 'none' ? 'bg-slate-200 text-slate-500' : 'text-emerald-700'
                    }`}
                    readOnly={ctrlType !== 'none'}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-600">Subtract Blank:</label>
                <select
                  value={bgType}
                  onChange={(e) => updatePlate({ bgType: e.target.value })}
                  className="border border-slate-300 rounded-md p-1.5 text-xs bg-white w-full outline-none"
                >
                  <option value="none">None</option>
                  <option value="manual">Manual</option>
                  {allCmpds.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-600">Calc/Man Blank OD:</label>
                {bgType === 'manual' ? (
                  <input
                    type="number"
                    step="0.01"
                    value={bgManualStr}
                    onChange={(e) => updatePlate({ bgManualStr: e.target.value })}
                    className="border border-slate-300 rounded-md p-1.5 w-full text-xs font-bold text-red-600 outline-none"
                  />
                ) : bgType !== 'none' ? (
                  <span className="text-xs font-bold text-red-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md w-full">
                    {bgOD.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-md w-full">
                    —
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Errors, Outliers & Fitting + Manual SD button */}
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col gap-3 flex-[2] min-w-[350px]">
            <div className="text-[10px] uppercase font-bold text-slate-500">
              Errors, Outliers & Fitting
            </div>
            <div className="flex flex-wrap items-center gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer hover:text-blue-600">
                  <input
                    type="checkbox"
                    checked={useFixedSD}
                    onChange={(e) => updatePlate({ useFixedSD: e.target.checked })}
                    className="cursor-pointer w-4 h-4 accent-blue-600"
                  />
                  Fixed SD ±:
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={fixedSDStr}
                  onChange={(e) => updatePlate({ fixedSDStr: e.target.value })}
                  disabled={!useFixedSD}
                  className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none ${
                    !useFixedSD
                      ? 'bg-slate-100 text-slate-400'
                      : 'bg-white font-bold text-blue-700'
                  }`}
                />
              </div>
              <div className="w-px h-8 bg-slate-200 hidden sm:block"></div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={autoTouchAll}
                  className="text-[10px] uppercase tracking-wider bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold py-1.5 px-3 rounded-md shadow-sm flex items-center justify-center gap-1 transition-colors"
                >
                  🎯 Auto-Touch All SD
                </button>
                <button
                  onClick={revertNormalSD}
                  className="text-[9px] uppercase tracking-wider bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-1 px-3 rounded-md shadow-sm flex items-center justify-center gap-1 transition-colors"
                >
                  🔄 Revert Normal SD
                </button>
              </div>
              <div className="w-px h-8 bg-slate-200 hidden md:block"></div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-600">Outlier Threshold (×Err):</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={outlierThreshStr}
                  onChange={(e) => updatePlate({ outlierThreshStr: e.target.value })}
                  className="border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none"
                />
              </div>
              <button
                onClick={() => cleanOutliers()}
                className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-black py-2 px-4 rounded-lg text-xs shadow-sm ml-auto"
              >
                🧹 Clean Outliers
              </button>

              {/* ✅ Manual SD button moved here */}
              <button
                onClick={() => setShowErrPanel(!showErrPanel)}
                className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ${
                  showErrPanel
                    ? 'bg-orange-100 border border-orange-400 text-orange-800'
                    : 'bg-white hover:bg-orange-50 text-orange-700 border border-orange-300'
                }`}
              >
                ⚠️ Manual SD
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-1">
              <label className="flex items-center gap-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                <span className="text-xs font-bold text-blue-800">Fit IC50 (4PL)</span>
                <input
                  type="checkbox"
                  checked={fitIC50}
                  onChange={(e) => updatePlate({ fitIC50: e.target.checked })}
                  className="w-4 h-4 cursor-pointer accent-blue-600"
                />
              </label>
              <label className="flex items-center gap-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                <span className="text-xs font-bold text-slate-700">Show Excl. Points</span>
                <input
                  type="checkbox"
                  checked={showExcl}
                  onChange={(e) => updatePlate({ showExcl: e.target.checked })}
                  className="w-4 h-4 cursor-pointer accent-slate-600"
                />
              </label>
              <button
                onClick={restoreAll}
                className="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold py-1.5 px-3 rounded-md ml-auto shadow-sm transition-colors"
              >
                ↩️ Restore All Excluded
              </button>
            </div>
          </div>
        </div>

        {/* ✅ Manual SD panel moved here (inside Error Management) */}
        {showErrPanel && (
          <div className="p-5 bg-orange-50 border border-orange-200 rounded-xl shadow-sm mt-4">
            <h3 className="text-sm font-black text-orange-800 mb-4">
              Manual SD Overrides (Weighted Fit)
            </h3>
            <div className="flex flex-col gap-4">
              {Object.entries(processedByRegion).map(([reg, comps]) => (
                <div key={reg} className="bg-white rounded-lg border border-orange-200 p-4 shadow-sm">
                  <h4 className="text-xs font-black text-slate-500 uppercase mb-3 border-b border-slate-100 pb-2">
                    Region: {reg}
                  </h4>
                  <div className="flex flex-col gap-4">
                    {comps
                      .filter((d) => !hiddenCmpds[d.name] && d.vPts.length > 0)
                      .map((comp) => (
                        <div key={comp.name} className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: comp.color }}
                              />
                              <span className="text-sm font-bold text-slate-800">{comp.name}</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  autoTouchSD(reg, comp.name);
                                  updatePlate({ useFixedSD: true });
                                }}
                                className="text-xs text-orange-700 bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded font-bold shadow-sm"
                              >
                                🎯 Auto-Touch
                              </button>
                              <button
                                onClick={() => cleanOutliers(reg, comp.name)}
                                className="text-xs text-yellow-800 bg-yellow-100 hover:bg-yellow-200 px-2 py-1 rounded font-bold shadow-sm"
                              >
                                🧹 Clean Outliers
                              </button>
                              <button
                                onClick={() => clearAllManual(comp.name)}
                                className="text-xs text-orange-600 hover:underline font-bold"
                              >
                                🔄 Reset
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                            {comp.vPts.map((pt) => {
                              const isOverridden = hasManual(comp.name, pt.realX);
                              return (
                                <ErrInput
                                  key={`${comp.name}-${concKey(pt.realX)}`}
                                  label={`${formatConc(pt.realX)} µM`}
                                  value={
                                    isOverridden ? getManual(comp.name, pt.realX) : pt.sdRaw
                                  }
                                  sdRaw={pt.sdRaw}
                                  isOverridden={isOverridden}
                                  onSave={(v) => storeManual(comp.name, pt.realX, v)}
                                  onReset={() => clearManual(comp.name, pt.realX)}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>

    {/* ===== GRAPHICAL PARAMETERS (Manual SD removed) ===== */}
    <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          {plotCmps.length > 0 && (
            <div className="flex-1">
              <span className="text-xs font-black text-slate-500 uppercase tracking-wide block mb-2">
                Filter & Color Series
              </span>
              <div className="flex flex-wrap gap-3">
                {plotCmps.map((cmp) => {
                  const hex = cmpColor(cmp, allCmpds.indexOf(cmp));
                  return (
                    <div
                      key={cmp}
                      className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenCmpds[cmp]}
                        onChange={(e) =>
                          setHiddenCmpds((p) => ({ ...p, [cmp]: !e.target.checked }))
                        }
                        className="w-4 h-4 cursor-pointer accent-blue-600"
                      />
                      <label
                        style={{
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          position: 'relative'
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 9999,
                            backgroundColor: hex,
                            display: 'inline-block',
                            border: '1px solid rgba(15,23,42,0.15)'
                          }}
                        />
                        <input
                          type="color"
                          value={hex}
                          style={{
                            position: 'absolute',
                            opacity: 0,
                            cursor: 'pointer',
                            width: 0,
                            height: 0
                          }}
                          onChange={(e) =>
                            setCmpColors({ ...cmpColors, [cmp]: e.target.value })
                          }
                        />
                      </label>
                      <span
                        className="text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"
                        onClick={() => setHiddenCmpds((p) => ({ ...p, [cmp]: !p[cmp] }))}
                      >
                        {cmp}
                      </span>
                      <button
                        onClick={() => {
                          const newHidden = {};
                          plotCmps.forEach((c) => {
                            if (c !== cmp) newHidden[c] = true;
                          });
                          setHiddenCmpds(newHidden);
                        }}
                        className="text-[10px] bg-blue-100 text-blue-800 hover:bg-blue-200 px-2 py-0.5 rounded-md transition-colors ml-1 font-bold"
                      >
                        Solo
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => setHiddenCmpds({})}
                  className="text-xs font-bold text-slate-500 underline hover:text-slate-800 ml-2"
                >
                  Show All
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            {/* ✅ Only Chart Config remains here */}
            <button
              onClick={() => setShowChartCfg(!showChartCfg)}
              className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ${
                showChartCfg
                  ? 'bg-slate-200 border border-slate-400 text-slate-900'
                  : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300'
              }`}
            >
              ⚙️ Chart Config
            </button>
          </div>
        </div>
        {showChartCfg && (
          <div className="p-5 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-4 shadow-sm">
            {[
              ['X Min', 'xMin'],
              ['X Max', 'xMax'],
              ['Y Min', 'yMin'],
              ['Y Max', 'yMax']
            ].map(([lbl, k]) => (
              <div key={k} className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">{lbl}</label>
                <input
                  type="number"
                  placeholder="Auto"
                  value={chartCfg[k]}
                  onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, [k]: e.target.value } })}
                  className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">X Axis Label</label>
              <input
                type="text"
                placeholder={`Log₁₀ [Conc. (${unit})]`}
                value={chartCfg.xAxisLabel}
                onChange={(e) =>
                  updatePlate({ chartCfg: { ...chartCfg, xAxisLabel: e.target.value } })
                }
                className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">Font Size</label>
              <input
                type="number"
                value={chartCfg.fontSize}
                onChange={(e) =>
                  updatePlate({
                    chartCfg: { ...chartCfg, fontSize: parseFloat(e.target.value) || 12 }
                  })
                }
                className="border border-slate-300 rounded-md p-2 text-sm outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">Point Style</label>
              <select
                value={chartCfg.ptStyle}
                onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, ptStyle: e.target.value } })}
                className="border border-slate-300 rounded-md p-2 text-sm bg-white outline-none"
              >
                {['circle', 'triangle', 'rect', 'rectRot', 'cross', 'crossRot', 'star'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">Point Size</label>
              <input
                type="number"
                value={chartCfg.ptSize}
                onChange={(e) =>
                  updatePlate({
                    chartCfg: { ...chartCfg, ptSize: parseFloat(e.target.value) || 1 }
                  })
                }
                className="border border-slate-300 rounded-md p-2 text-sm outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">Line Style / Thick.</label>
              <div className="flex gap-2">
                <select
                  value={chartCfg.lineStyle}
                  onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, lineStyle: e.target.value } })}
                  className="border border-slate-300 rounded-md p-2 text-sm bg-white flex-1 outline-none"
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
                <input
                  type="number"
                  value={chartCfg.lineThickness}
                  onChange={(e) =>
                    updatePlate({
                      chartCfg: { ...chartCfg, lineThickness: parseFloat(e.target.value) || 2 }
                    })
                  }
                  className="border border-slate-300 rounded-md p-2 text-sm w-16 outline-none"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">Chart Split (DR Width %)</label>
              <input
                type="range"
                min="20"
                max="80"
                step="5"
                value={drWidth}
                onChange={(e) => setDrWidth(parseInt(e.target.value))}
                className="accent-blue-600 mt-2"
                disabled={!fitIC50}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600">Chart Height (px)</label>
              <input
                type="range"
                min="200"
                max="1000"
                step="25"
                value={chartH}
                onChange={(e) => setChartH(parseInt(e.target.value))}
                className="accent-blue-600 mt-2"
              />
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>

    {/* REGION CHARTS */}
    {Object.entries(processedByRegion).map(([reg, comps]) => (
      <RegionCharts
        key={reg}
        regionName={reg}
        regionData={comps}
        config={{
          chartCfg,
          fitIC50,
          showExcl,
          eScale,
          fsPanel,
          chartH,
          drWidth,
          hiddenCmpds,
          unit,
          cellConfig,
          setCellConfig: (cfg) => updatePlate({ cellConfig: cfg }),
          activePlateDim,
          toggleFs,
          renameRegion: openRenameRegion
        }}
      />
    ))}
  </div>
</CollapsibleSection>
