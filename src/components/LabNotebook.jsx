import React, { useState, useMemo, useEffect } from 'react';
import { getDirectImageUrl, repairContentImages } from '../data/constants';
import { FCSDataVisualizations } from './FlowCytometrySections';
import { CLASSIFICATION_MAP, PRIMARY_CATEGORIES, experimentTypeFilterOptions, matchesExperimentTypeFilter } from '../data/testTypes';
import { SearchableSelect } from './SearchableSelect';
import { getNmr1dDisplay } from './NMRSections';
import { getTestTypeMeta, getNotebookTypeKey } from './testTypeMeta';
import { sequenceForMoleculeType, NUCLEIC_SEQUENCES_KEY } from '../utils/sequenceNatures';
import { Icon } from './Icons';
import { NOTEBOOK_ANALYSIS_PREVIEWS, RemovablePanel, ChunkedTable, NMRSpectraPreview, PlateGridPreview, PlateMapPreview, Formula2DPreview, CDSpectraChart, CDSimChartPreview, CloningUvSpectraChart, CloningSimChartPreview, ProteinChromatogramChart, NMR_SPECTRUM_TYPES, NMRFittingSimPreview, MDParamsPreview, MDAtomTablePreview, normalizeImagePreview } from './notebookPreviews';

/* ============================================================================
   NOTEBOOK TEST ITEM
========================================================================== */
// Append the unit to a numeric condition value when available. `fallback` is
// used only for legacy data that predates the unit fields. If the value
// already contains the unit string, it is left untouched.
const fmtVal = (value, unit, fallback = '') => {
  const v = String(value ?? '');
  if (!v) return '';
  const u = String(unit || fallback || '').trim();
  if (!u) return v;
  return v.includes(u) ? v : `${v} ${u}`;
};

export const NotebookTestItem = ({
  test, tests, jumpToTest,
  showConditions, showMolecularFormula, showInstrumental, showReport, showImages,
  showData, showDataAnalysisGraphs,
  showSimImages, selectedSpectrumTypes = [],
  imageScale = 100
}) => {
  const [localTest, setLocalTest] = useState(test);
  useEffect(() => setLocalTest(test), [test]);

  const [showCondLocal, setShowCondLocal] = useState(showConditions);
  const [showMolFormLocal, setShowMolFormLocal] = useState(showMolecularFormula);
  const [showCmpdLocal, setShowCmpdLocal] = useState(true);
  const [showInstLocal, setShowInstLocal] = useState(showInstrumental);
  const [showRepLocal, setShowRepLocal] = useState(showReport);
  const [showImgLocal, setShowImgLocal] = useState(showImages);
  const [showDataLocal, setShowDataLocal] = useState(showData);
  const [showAnaLocal, setShowAnaLocal] = useState(showDataAnalysisGraphs);
  const [showSimImgLocal, setShowSimImgLocal] = useState(showSimImages);
  
  const [showRawNmrData, setShowRawNmrData] = useState(true);

  useEffect(() => setShowCondLocal(showConditions), [showConditions]);
  useEffect(() => setShowMolFormLocal(showMolecularFormula), [showMolecularFormula]);
  useEffect(() => setShowInstLocal(showInstrumental), [showInstrumental]);
  useEffect(() => setShowRepLocal(showReport), [showReport]);
  useEffect(() => setShowImgLocal(showImages), [showImages]);
  useEffect(() => setShowDataLocal(showData), [showData]);
  useEffect(() => setShowAnaLocal(showDataAnalysisGraphs), [showDataAnalysisGraphs]);
  useEffect(() => setShowSimImgLocal(showSimImages), [showSimImages]);

  const mockCtx = useMemo(() => ({
    activeTest: localTest,
    updateActiveTest: (patch) => setLocalTest(prev => ({ ...prev, ...patch })),
    allTests: tests || [],
    instances: (tests || []).filter(t => t.name === localTest.name)
  }), [localTest, tests]);

  const isPlate = localTest.type && localTest.type.startsWith('plate-') && localTest.type !== 'plate-9x9box';
  const isNMR = localTest.type === 'nmr';
  const isCD = localTest.type === 'cd';
  const isNMRFitting = localTest.type === 'nmr-fittings';
  const isCloning = localTest.type === 'cloning';
  const isProteinExp = localTest.type === 'protein_expression';
  const isMD = localTest.type === 'md_simulation';
  const isFlow = localTest.type === 'flow_cytometry';
  const isMicro = localTest.type === 'microscopy';
  
  const typeMeta = getTestTypeMeta(localTest.type);
  const typeLabel = typeMeta.label;
  const typeIcon = typeMeta.icon;
  const nbTypeKey = getNotebookTypeKey(localTest.type);
  const nbAnalysisPreviews = NOTEBOOK_ANALYSIS_PREVIEWS[nbTypeKey];
  
  const compounds = [...new Set([...(localTest.selectedCompounds || []), ...(localTest.compoundsSelected || []), ...(localTest.compound ? localTest.compound.split(',') : [])])].map(s => s.trim()).filter(Boolean);
  const plasmids = [...new Set([...(localTest.plasmids || []), ...(localTest.plasmid ? [localTest.plasmid] : [])])].filter(Boolean);

  const getMolecularFormula = () => {
    if (localTest.smiles) return localTest.smiles;
    // La séquence DE LA NATURE de cette condition : une condition ADN / ARN
    // montre sa propre séquence (utils/sequenceNatures.js), pas celle des
    // protéines — et `proteinSequence` reste le repli des données anciennes.
    const natureSeq = sequenceForMoleculeType(localTest, localTest.moleculeType);
    if (natureSeq) return natureSeq;
    if (localTest.proteinSequence) return localTest.proteinSequence;
    const nucleic = localTest[NUCLEIC_SEQUENCES_KEY];
    if (nucleic && (nucleic.dna || nucleic.rna)) return nucleic.dna || nucleic.rna;
    if (localTest.sequence) return localTest.sequence;
    if (localTest.dnaSequence) return localTest.dnaSequence;
    if (localTest.sugarChoice) return `${localTest.sugarChoice} (${localTest.sugarAnomer || ''})`;
    if (localTest.lipidChoice) return localTest.lipidChoice;
    return null;
  };
  const molFormula = getMolecularFormula();

  const simImgList = useMemo(() => {
    const looksLikeImage = (it) => {
      if (typeof it === 'string') return /^(data:image|https?:\/\/|blob:)/i.test(it) || it.startsWith('/') || it.length > 200;
      if (it && typeof it === 'object') return Boolean(it.url || it.dataUrl || it.src || it.image || (typeof it.data === 'string' && it.data.startsWith('data:image')));
      return false;
    };
    const imgSrc = (it) => (typeof it === 'string' ? it : (it.url || it.dataUrl || it.src || it.image || it.data));
    const normalize = (v) => (Array.isArray(v) ? v : [v]).filter(looksLikeImage);

    const collected = [];
    Object.entries(localTest || {}).forEach(([key, val]) => {
      if (/cfg|config|setting|type|html|css|cdSim/i.test(key)) return;
      if (looksLikeImage(val) || Array.isArray(val)) {
        collected.push(...normalize(val));
      } else if (val && typeof val === 'object') {
        if (/sim|fit/i.test(key)) {
          Object.values(val).forEach(v2 => {
            if (looksLikeImage(v2) || Array.isArray(v2)) {
              collected.push(...normalize(v2));
            } else if (v2 && typeof v2 === 'object') {
              Object.values(v2).forEach(v3 => {
                if (looksLikeImage(v3)) collected.push(...normalize(v3));
              });
            }
          });
        }
        Object.entries(val).forEach(([k2, v2]) => {
          if (/img|image|snapshot|figure|picture|photo/i.test(k2) && (Array.isArray(v2) || looksLikeImage(v2))) {
            collected.push(...normalize(v2));
          }
        });
      }
    });

    const seen = new Set();
    return collected.filter((it) => {
      const s = imgSrc(it);
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    }).map(imgSrc);
  }, [localTest]);

  // All images anywhere in the test object — including DOSY / gel / spectra /
  // generic figure fields — so every experiment's images show up in the notebook.
  const allImages = [...new Set([
    ...(localTest.images || []),
    ...(localTest.nmrSpectraImages || []),
    ...(localTest.dosyImages || []),
    ...(localTest.dockingImages || []),
    ...simImgList
  ])];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden break-inside-avoid avoid-break mb-4">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon name={typeIcon} size={22} className="text-blue-600 shrink-0" />
          <div>
            <h3 className="font-bold text-slate-800 text-sm">{localTest.name} {localTest.bestMeasurement && '⭐'}</h3>
            <p className="text-[10px] text-slate-500">
              {localTest.date} · {localTest.instanceName || 'Primary'} · {typeLabel}
            </p>
            {(localTest.projectNames || []).length > 0 && (
              <p className="text-[9px] font-bold text-violet-700 mt-0.5 flex flex-wrap gap-1">
                {(localTest.projectNames || []).map((pn) => (
                  <span key={pn} className="bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">📁 {pn}</span>
                ))}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => jumpToTest(localTest.id)}
          className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          Open Test →
        </button>
      </div>
      <div className="px-5 py-4">
        
        {molFormula && (
          <RemovablePanel title="Molecular Formula / System" visible={showMolFormLocal} setVisible={setShowMolFormLocal}>
            <div className="font-mono text-xs break-all bg-slate-50 p-2 rounded border border-slate-200 text-slate-700 whitespace-pre-wrap">
              {molFormula}
            </div>
            <Formula2DPreview test={localTest} />
          </RemovablePanel>
        )}

        <RemovablePanel title="Experimental Conditions" visible={showCondLocal} setVisible={setShowCondLocal}>
          <div className="flex flex-wrap gap-2">
            {localTest.concentration && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Conc: {fmtVal(localTest.concentration, localTest.concentrationUnit, 'µM')}</span>}
            {localTest.compoundConcentrations && Object.keys(localTest.compoundConcentrations).length > 0 && (
              Object.entries(localTest.compoundConcentrations).map(([cmp, c]) =>
                c !== '' && c != null ? (
                  <span key={cmp} className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">
                    {cmp}: {fmtVal(c, localTest.concentrationUnit, 'µM')}
                  </span>
                ) : null
              )
            )}
            {(localTest.solvent || localTest.solventName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Solvent: {localTest.solvent || localTest.solventName}</span>}
            {(localTest.buffer || localTest.bufferName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Buffer: {localTest.buffer || localTest.bufferName}</span>}
            {(localTest.additive || localTest.additiveName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Additive: {localTest.additive || localTest.additiveName} {fmtVal(localTest.additiveConc, localTest.additiveUnit)}</span>}
            {localTest.temperature && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">T: {fmtVal(localTest.temperature, localTest.temperatureUnit, '°C')}</span>}
            {localTest.ph && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">pH: {localTest.ph}</span>}
            {localTest.saltConcentration && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Salt: {fmtVal(localTest.saltConcentration, localTest.saltConcentrationUnit, 'mM')}</span>}
            {localTest.otherMolecule && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ligand: {localTest.otherMolecule}</span>}
            {localTest.ratio && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ratio: {localTest.ratio}</span>}
            
            {/* Flow Cytometry specific fields */}
            {isFlow && (
              <>
                {localTest.experimentDate && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Date: {localTest.experimentDate}</span>}
                {localTest.cellNumber && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Cells: {localTest.cellNumber}</span>}
                {localTest.liveDeadStain && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Live/Dead: {localTest.liveDeadStain}</span>}
                {localTest.fixation && localTest.fixation !== 'None' && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Fixation: {localTest.fixation}</span>}
                {localTest.permeabilization && localTest.permeabilization !== 'None' && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Permeabilization: {localTest.permeabilization}</span>}
                {localTest.otherConditions && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Other: {localTest.otherConditions}</span>}
              </>
            )}

            {/* Microscopy specific fields */}
            {isMicro && (
              <>
                {localTest.experimentDate && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Date: {localTest.experimentDate}</span>}
                {localTest.cellNumber && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Cells: {localTest.cellNumber}</span>}
                {localTest.fixation && localTest.fixation !== 'None' && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Fixation: {localTest.fixation}</span>}
                {localTest.permeabilization && localTest.permeabilization !== 'None' && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Permeabilization: {localTest.permeabilization}</span>}
                {localTest.otherConditions && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Other: {localTest.otherConditions}</span>}
              </>
            )}

            {/* Protein Expression specific fields */}
            {isProteinExp && (
              <>
                {localTest.cultureVolume && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Culture: {fmtVal(localTest.cultureVolume, localTest.cultureVolumeUnit, 'mL')}</span>}
                {localTest.medium && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Medium: {localTest.medium}</span>}
                {localTest.antibiotic && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Antibiotic: {fmtVal(localTest.antibiotic, localTest.antibioticUnit, 'µg/mL')}</span>}
                {localTest.inductionMethod && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Induction: {localTest.inductionMethod}</span>}
                {localTest.iptgConcentration && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">IPTG: {fmtVal(localTest.iptgConcentration, localTest.iptgConcentrationUnit, 'mM')}</span>}
                {localTest.inductionOD && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Ind. OD: {localTest.inductionOD}</span>}
                {localTest.inductionTemp && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Ind. Temp: {fmtVal(localTest.inductionTemp, localTest.inductionTempUnit, '°C')}</span>}
                {localTest.inductionDuration && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Ind. Duration: {fmtVal(localTest.inductionDuration, localTest.inductionDurationUnit, 'h')}</span>}
                {localTest.harvestOD && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Harvest OD: {localTest.harvestOD}</span>}
                {localTest.lysisMethod && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Lysis: {localTest.lysisMethod}</span>}
                {localTest.lysisBuffer && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Lysis Buf: {localTest.lysisBuffer}</span>}
                {localTest.proteaseInhibitors && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Inhibitors: {localTest.proteaseInhibitors}</span>}
                {localTest.proteinTag && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Tag: {localTest.proteinTag}</span>}
                {localTest.cleavageProtease && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Protease: {localTest.cleavageProtease}</span>}
                {localTest.columnType && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Column: {localTest.columnType}</span>}
                {localTest.elutionConditions && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Elution: {localTest.elutionConditions}</span>}
                {localTest.storageBuffer && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Storage Buf: {localTest.storageBuffer}</span>}
              </>
            )}

            {/* Cloning specific fields */}
            {isCloning && (
              <>
                {localTest.vectorBackbone && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Vector: {localTest.vectorBackbone}</span>}
                {localTest.cloningMethod && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Method: {localTest.cloningMethod}</span>}
                {localTest.selectionMarker && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Selection: {localTest.selectionMarker}</span>}
                {localTest.sequencingStatus && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Seq: {localTest.sequencingStatus}</span>}
              </>
            )}
          </div>
        </RemovablePanel>

        <RemovablePanel title="Compounds & Biologicals" visible={showCmpdLocal} setVisible={setShowCmpdLocal}>
          <div className="flex flex-wrap gap-1.5">
            {compounds.length === 0 && plasmids.length === 0 && (!localTest.cellLines || localTest.cellLines.length === 0) && (
              <span className="text-[10px] text-slate-400 italic">None defined</span>
            )}
            {compounds.map(c => <span key={c} className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-bold">{c}</span>)}
            {(localTest.cellLines || []).map(cl => <span key={cl} className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full font-bold">🦠 {cl}</span>)}
            {plasmids.map(p => <span key={p} className="text-[10px] bg-violet-50 border border-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-bold">🧬 {p}</span>)}
          </div>
        </RemovablePanel>

        <RemovablePanel title="Instrumental Setup" visible={showInstLocal} setVisible={setShowInstLocal}>
          <div className="flex flex-wrap gap-2">
            {(localTest.spectrometer || localTest.instrument || localTest.nmrInstrument) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Instrument: {localTest.spectrometer || localTest.instrument || localTest.nmrInstrument}</span>}
            {(localTest.probe || localTest.nmrProbe) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Probe: {localTest.probe || localTest.nmrProbe}</span>}
            {(localTest.pulseSequence || localTest.experiment || localTest.nmrExperiment) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Pulse Seq: {localTest.pulseSequence || localTest.experiment || localTest.nmrExperiment}</span>}
            {localTest.pathLength && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Path Length: {fmtVal(localTest.pathLength, localTest.pathLengthUnit, 'cm')}</span>}
            
            {/* Flow Cytometry specific fields */}
            {isFlow && (
              <>
                {localTest.cytometerModel && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Model: {localTest.cytometerModel}</span>}
                {localTest.cytometerSerial && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Serial: {localTest.cytometerSerial}</span>}
                {localTest.acquisitionSoftware && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Software: {localTest.acquisitionSoftware}</span>}
                {localTest.lasers && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Lasers: {localTest.lasers}</span>}
                {localTest.threshold && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Threshold: {localTest.threshold}</span>}
                {localTest.compensationApplied && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Compensation: {localTest.compensationApplied}</span>}
                {localTest.plateName && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Plate: {localTest.plateName}</span>}
                {localTest.wellId && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Well: {localTest.wellId}</span>}
              </>
            )}

            {/* Microscopy specific instrumental fields */}
            {isMicro && (
              <>
                {localTest.microscopyType && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Type: {localTest.microscopyType}</span>}
                {localTest.microscopeModel && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Model: {localTest.microscopeModel}</span>}
                {localTest.objective && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Objective: {localTest.objective}</span>}
                {localTest.laserLines && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Lasers: {localTest.laserLines}</span>}
                {localTest.detector && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Detector: {localTest.detector}</span>}
                {localTest.filterCubes && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Filters: {localTest.filterCubes}</span>}
                {localTest.magnification && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Magnification: {localTest.magnification}</span>}
                {localTest.acquisitionSoftware && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Software: {localTest.acquisitionSoftware}</span>}
                {localTest.plateName && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Plate: {localTest.plateName}</span>}
                {localTest.wellId && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Well: {localTest.wellId}</span>}
              </>
            )}
          </div>
        </RemovablePanel>

        {isCloning && (localTest.pcrProgram?.length > 0 || localTest.reactionMix?.length > 0 || localTest.cloningStrategy) && (
          <RemovablePanel title="Cloning Strategy & Setup" visible={showInstLocal} setVisible={setShowInstLocal}>
            {localTest.cloningStrategy && (
              <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded text-xs flex flex-wrap gap-2">
                <span className="font-bold text-slate-600 mt-1">Strategy:</span>
                <span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">{localTest.cloningStrategy.method || 'restriction'}</span>
                <span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Insert: {localTest.cloningStrategy.insertCompound || '—'}</span>
                <span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Vector: {localTest.cloningStrategy.vectorName || '—'}</span>
                {localTest.cloningStrategy.method === 'gibson' ? (
                  <><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Overlap: {localTest.cloningStrategy.overlap || 20} bp</span><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Pos: {localTest.cloningStrategy.insertionIndex ?? '—'}</span></>
                ) : (
                  <><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">5′ {localTest.cloningStrategy.enzyme5 || '—'}</span><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">3′ {localTest.cloningStrategy.enzyme3 || '—'}</span></>
                )}
              </div>
            )}

            <div className="flex flex-col lg:flex-row gap-4 w-full">
              {localTest.pcrProgram && localTest.pcrProgram.length > 0 && (
                <div className="flex flex-col items-center flex-1">
                  <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase w-full text-center">Thermal Cycler</h5>
                  <ChunkedTable
                    data={localTest.pcrProgram}
                    renderHeader={() => (
                      <tr><th className="px-3 py-1.5 border-r">Step</th><th className="px-3 py-1.5 border-r">Temp (°C)</th><th className="px-3 py-1.5 border-r">Time</th><th className="px-3 py-1.5">Cycles</th></tr>
                    )}
                    renderRow={(s, i) => (
                      <tr key={s.id || i} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-bold border-r">{s.name}</td><td className="px-3 py-1.5 border-r">{s.temp}</td><td className="px-3 py-1.5 border-r">{s.timeValue} {s.timeUnit}</td><td className="px-3 py-1.5">{s.cycles}</td></tr>
                    )}
                  />
                </div>
              )}
              {localTest.reactionMix && localTest.reactionMix.length > 0 && (
                <div className="flex flex-col items-center flex-1">
                  <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase w-full text-center">Reaction Mix</h5>
                  <ChunkedTable
                    data={localTest.reactionMix}
                    renderHeader={() => (
                      <tr><th className="px-3 py-1.5 border-r">Component</th><th className="px-3 py-1.5 border-r">Stock</th><th className="px-3 py-1.5 border-r">Vol (µL)</th><th className="px-3 py-1.5">Notes</th></tr>
                    )}
                    renderRow={(r, i) => (
                      <tr key={r.id || i} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-bold border-r">{r.name}</td><td className="px-3 py-1.5 border-r">{r.stock}</td><td className="px-3 py-1.5 border-r">{r.volume}</td><td className="px-3 py-1.5 text-slate-500">{r.note}</td></tr>
                    )}
                  />
                </div>
              )}
            </div>
          </RemovablePanel>
        )}

        {(localTest.comments || localTest.report) && (
          <RemovablePanel title="Report" visible={showRepLocal} setVisible={setShowRepLocal}>
            {localTest.comments && (
              <div className="text-xs text-slate-700 prose prose-sm max-w-none mb-2" dangerouslySetInnerHTML={{ __html: repairContentImages(localTest.comments) }} />
            )}
            {localTest.report && (
              <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded mb-2" dangerouslySetInnerHTML={{ __html: repairContentImages(localTest.report) }} />
            )}
          </RemovablePanel>
        )}
        
        {(allImages.length > 0 || (localTest.gelImages && localTest.gelImages.length > 0)) && (
          <RemovablePanel title="Images" visible={showImgLocal} setVisible={setShowImgLocal}>
            {allImages.length > 0 && (
              <div className="flex flex-col items-center gap-6 mt-2 w-full">
                {allImages.map((img, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-2 w-full">
                    <a href={typeof img === 'string' ? img : img.url} target="_blank" rel="noopener noreferrer" className="flex justify-center w-full">
                      <img
                        src={getDirectImageUrl(normalizeImagePreview(typeof img === 'string' ? img : img.url))}
                        alt={`Image ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        style={{ maxWidth: '100%', width: `${imageScale}%`, height: 'auto', maxHeight: '1125px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white' }}
                      />
                    </a>
                    <span className="text-[10px] text-slate-500 italic text-center w-full">
                      {(Array.isArray(localTest.figureCaptions) && localTest.figureCaptions[idx]) || (typeof img === 'object' && img.caption) || `Figure ${idx + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {localTest.gelImages && localTest.gelImages.length > 0 && (
              <div className={`flex flex-col items-center w-full ${allImages.length > 0 ? 'mt-6 border-t border-slate-100 pt-4' : 'mt-2'}`}>
                <h5 className="text-[10px] font-bold text-slate-500 mb-2 uppercase text-center w-full">Gel Images</h5>
                <div className="flex flex-col items-center gap-6 w-full">
                  {localTest.gelImages.map((imgSrc, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-2 bg-white p-3 border border-slate-200 rounded shadow-sm w-full">
                      <a href={typeof imgSrc === 'string' ? imgSrc : imgSrc.url} target="_blank" rel="noopener noreferrer" className="flex justify-center w-full">
                        <img
                          src={getDirectImageUrl(normalizeImagePreview(typeof imgSrc === 'string' ? imgSrc : imgSrc.url))}
                          alt={`Gel ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          style={{ maxWidth: '100%', width: `${imageScale}%`, height: 'auto', maxHeight: '1125px', objectFit: 'contain' }}
                        />
                      </a>
                      <span className="text-[10px] text-slate-500 italic text-center w-full">Gel {idx + 1}</span>
                    </div>
                  ))}
                </div>
                {localTest.gelComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.gelComment}</p>}
              </div>
            )}
          </RemovablePanel>
        )}

        <RemovablePanel title="Data" visible={showDataLocal} setVisible={setShowDataLocal}>
          {isPlate && <PlateGridPreview test={localTest} />}
          {(isFlow || isMicro) && <PlateMapPreview test={localTest} />}
          {isCD && <CDSpectraChart wavelengthData={localTest.wavelengthData} spectraColumns={localTest.spectraColumns} chartCfg={localTest.chartCfg} />}
          {isFlow && <FCSDataVisualizations ctx={mockCtx} updater={0} />}
          {isMicro && Array.isArray(localTest.msVideos) && localTest.msVideos.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {localTest.msVideos.map((v) => (
                <span key={v.id} className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">🎬 {v.filename}</span>
              ))}
            </div>
          )}
          {isCloning && localTest.uvSpectra && localTest.uvSpectra.length > 0 && (
            <CloningUvSpectraChart uvSpectra={localTest.uvSpectra} />
          )}
          {isCloning && localTest.dnaQuantification && localTest.dnaQuantification.length > 0 && (
            <div className="flex flex-col items-center w-full mt-2">
              <ChunkedTable
                data={localTest.dnaQuantification}
                renderHeader={() => (
                  <tr><th className="px-3 py-1.5">Sample</th><th className="px-3 py-1.5">Conc. ng/µL</th><th className="px-3 py-1.5">260/280</th><th className="px-3 py-1.5">Notes</th></tr>
                )}
                renderRow={(row, i) => (
                  <tr key={row.id || i}>
                    <td className="px-3 py-1.5 font-bold">{row.sample}</td>
                    <td className="px-3 py-1.5 text-blue-700 font-bold">{row.concentration}</td>
                    <td className="px-3 py-1.5">{row.a260_280}</td>
                    <td className="px-3 py-1.5">{row.notes}</td>
                  </tr>
                )}
              />
              {localTest.dnaQuantComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.dnaQuantComment}</p>}
            </div>
          )}
          {isProteinExp && (() => {
            const chrs = Array.isArray(localTest.chromatograms) ? localTest.chromatograms : localTest.chromatogramRaw ? [{ id: 'chr_legacy', name: 'Chromatogram 1', method: 'Affinity', rawData: localTest.chromatogramRaw }] : [];
            if (chrs.length > 0) return (
               <div className="mb-4 flex flex-col items-center w-full">
                 <div className="overflow-x-auto text-xs border border-slate-200 rounded mt-2 mb-4 flex justify-center w-full bg-slate-50 shadow-sm">
                   <table className="w-full text-left select-text bg-white" draggable="true">
                     <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                       <tr>
                         <th className="px-3 py-1.5 border-r">Run Name</th>
                         <th className="px-3 py-1.5 border-r">Method Type</th>
                         <th className="px-3 py-1.5">Running Buffer</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                       {chrs.map((chr, idx) => (
                         <tr key={chr.id || idx}>
                           <td className="px-3 py-1.5 font-bold border-r">{chr.name || `Chromatogram ${idx + 1}`}</td>
                           <td className="px-3 py-1.5 text-blue-700 font-bold border-r">{chr.method || '—'}</td>
                           <td className="px-3 py-1.5">{chr.buffer || '—'}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
                 <div className="w-full"><ProteinChromatogramChart chromatograms={chrs} /></div>
                 {localTest.chromatogramComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.chromatogramComment}</p>}
               </div>
            );
            return null;
          })()}
          {isProteinExp && localTest.yieldData && localTest.yieldData.length > 0 && (
            <div className="mb-4 flex flex-col items-center w-full">
              <ChunkedTable
                data={localTest.yieldData}
                renderHeader={() => (
                  <tr><th className="px-3 py-1.5 border-r">Fraction</th><th className="px-3 py-1.5 border-r">Conc (mg/mL)</th><th className="px-3 py-1.5 border-r">Vol (mL)</th><th className="px-3 py-1.5 border-r">Total (mg)</th><th className="px-3 py-1.5">Purity %</th></tr>
                )}
                renderRow={(row, i) => (
                  <tr key={row.id || i}>
                    <td className="px-3 py-1.5 font-bold border-r">{row.fraction}</td>
                    <td className="px-3 py-1.5 border-r">{row.concentration}</td>
                    <td className="px-3 py-1.5 border-r">{row.volume}</td>
                    <td className="px-3 py-1.5 text-blue-700 font-bold border-r">{row.totalMass}</td>
                    <td className="px-3 py-1.5">{row.purity}</td>
                  </tr>
                )}
              />
              {localTest.yieldComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.yieldComment}</p>}
            </div>
          )}
          {isNMR && localTest.chemicalShifts && Object.keys(localTest.chemicalShifts).length > 0 && (
            <div className="flex flex-col items-center w-full mt-2">
              <ChunkedTable
                data={Object.entries(localTest.chemicalShifts)}
                renderHeader={() => (
                  <tr><th className="px-4 py-2 border-r">Atom</th><th className="px-4 py-2">Shift (ppm)</th></tr>
                )}
                renderRow={([atom, shift], i) => (
                  <tr key={atom || i}>
                    <td className="px-4 py-2 font-mono text-slate-700 font-semibold border-r">{atom}</td>
                    <td className="px-4 py-2 font-mono text-blue-700">{shift}</td>
                  </tr>
                )}
              />
            </div>
           )}
           {/* 1D imported Bruker spectrum in LabNotebook (Data tick) */}
           {isNMR && localTest.nmr1dSpectrum && localTest.nmr1dSpectrum.xs && localTest.nmr1dSpectrum.xs.length > 0 && (() => {
             const spec = localTest.nmr1dSpectrum;
             // Le réglage (calibration + phase) vit dans `nmr1dProcessing` : il
             // survit au document du dataset, là où la copie d'affichage peut
             // être remplacée par un marqueur « omitted ».
             const disp = getNmr1dDisplay(spec, localTest.nmr1dProcessing) || { xs: spec.xs, ys: spec.ys };
             const xs = disp.xs, ys = disp.ys;
             const maxY = Math.max(...ys.map(Math.abs), 1);
             const svgW = 480, plotH = 100, axisH = 26, totalH = plotH + axisH;
             const padL = 6, padR = 6;
             const plotW = svgW - padL - padR;
             const xMin = Math.min(...xs), xMax = Math.max(...xs);
             const step = Math.max(1, Math.floor(xs.length / 1200));
             const pts = [];
             for (let i = 0; i < xs.length; i += step) {
               const px = padL + plotW - ((xs[i] - xMin) / (xMax - xMin)) * plotW;
               const py = plotH - ((ys[i] / maxY) * 0.9 + 0.05) * plotH;
               pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
             }
             const range = xMax - xMin;
             const rawStep = range / 5;
             const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
             const niceStep = [0.1,0.2,0.5,1,2,5,10,20,50].map(s => s * mag).find(s => s >= rawStep) || rawStep;
             const tickStart = Math.ceil(xMin / niceStep) * niceStep;
             const ticks = [];
             for (let t = tickStart; t <= xMax + niceStep * 0.01; t += niceStep) ticks.push(+t.toFixed(3));
             const ppmToPx = (ppm) => padL + plotW - ((ppm - xMin) / (xMax - xMin)) * plotW;
             return (
               <div className="flex flex-col items-center w-full mt-2 gap-1">
                 <span className="text-[10px] font-bold text-slate-500 uppercase">
                   Imported 1r Spectrum — {spec.meta?.nucleus || 'NMR'}{spec.meta?.sfo1 ? ` (${spec.meta.sfo1.toFixed(0)} MHz)` : ''}
                 </span>
                 <svg width="100%" viewBox={`0 0 ${svgW} ${totalH}`} className="border border-slate-200 rounded bg-white">
                   <polyline points={pts.join(' ')} fill="none" stroke="#3b82f6" strokeWidth="1" />
                   <line x1={padL} y1={plotH} x2={padL + plotW} y2={plotH} stroke="#94a3b8" strokeWidth={1} />
                   {ticks.map((t, i) => {
                     const px = ppmToPx(t);
                     if (px < padL - 1 || px > padL + plotW + 1) return null;
                     return (
                       <g key={i}>
                         <line x1={px} y1={plotH} x2={px} y2={plotH + 5} stroke="#94a3b8" strokeWidth={1} />
                         <text x={px} y={plotH + 14} textAnchor="middle" fontSize="7" fill="#94a3b8">
                           {t % 1 === 0 ? t.toFixed(0) : t.toFixed(1)}
                         </text>
                       </g>
                     );
                   })}
                   <text x={svgW / 2} y={totalH - 3} textAnchor="middle" fontSize="7" fill="#64748b" fontWeight="bold">
                     Chemical Shift (ppm)
                   </text>
                 </svg>
               </div>
             );
           })()}
            {/* 2D spectrum images (uploaded images + predicted peaks) */}
            {isNMR && (Array.isArray(localTest.nmr2dImages) ? localTest.nmr2dImages : (localTest.nmr2dImage ? [localTest.nmr2dImage] : [])).length > 0 && (() => {
              const imgs = Array.isArray(localTest.nmr2dImages) ? localTest.nmr2dImages : [localTest.nmr2dImage];
              return (
                <div className="flex flex-col items-center w-full mt-2 gap-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    2D Spectrum Images — predicted peaks
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                    {imgs.map((cfg, idx) => {
                      if (!cfg || !cfg.image) return null;
                      const imgW = cfg.imgW || 600, imgH = cfg.imgH || 480;
                      const placed = Array.isArray(cfg.placedPeaks) ? cfg.placedPeaks : [];
                      const color = cfg.peakColor || '#ef4444';
                      const labelColor = cfg.labelColor || color;
                      const fontSize = cfg.labelFontSize || 11;
                      const peakSize = cfg.peakSize || 4;
                      const showLabels = cfg.showLabels !== false;
                      return (
                        <div key={idx} className="flex flex-col items-center w-full gap-1">
                          <span className="text-[9px] font-bold text-slate-500 uppercase">
                            {cfg.title || `2D Spectrum ${idx + 1}`}
                          </span>
                          <div className="relative w-full" style={{ maxWidth: imgW, aspectRatio: `${imgW} / ${imgH}` }}>
                            <img src={cfg.image} alt="2D spectrum" className="absolute inset-0 w-full h-full object-contain rounded-lg border border-slate-200 bg-white" />
                            <svg viewBox={`0 0 ${imgW} ${imgH}`} className="absolute inset-0 w-full h-full">
                              {showLabels && placed.map((pk, i) => {
                                const ldx = pk.ldx || 0, ldy = pk.ldy || 0;
                                return (
                                <g key={i}>
                                  <circle cx={pk.px} cy={pk.py} r={peakSize} fill={color} stroke="white" strokeWidth={1} opacity={0.85} />
                                  {(ldx !== 0 || ldy !== 0) && (
                                    <line x1={pk.px + peakSize + 1} y1={pk.py} x2={pk.px + ldx + peakSize + 2} y2={pk.py + ldy - peakSize - 2} stroke={color} strokeWidth={1} opacity={0.45} />
                                  )}
                                  {pk.label && (
                                    <text x={pk.px + ldx + peakSize + 2} y={pk.py + ldy - peakSize - 2} fontSize={fontSize} fill="rgba(255,255,255,0.55)" stroke="rgba(255,255,255,0.55)" strokeWidth={3} strokeLinejoin="round" fontWeight="bold">{pk.label}</text>
                                  )}
                                  {pk.label && (
                                    <text x={pk.px + ldx + peakSize + 2} y={pk.py + ldy - peakSize - 2} fontSize={fontSize} fill={labelColor} fontWeight="bold">{pk.label}</text>
                                  )}
                                </g>
                                );
                              })}
                            </svg>
                          </div>
                          {placed.length === 0 && (
                            <p className="text-[9px] text-slate-400 italic">No predicted peaks stored — open the 2D overlay on the NMR page to place them.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

           {isNMRFitting && localTest.nmrTables && localTest.nmrTables.length > 0 && (
            <div className="flex flex-col gap-4 mt-2">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase">NMR Fitting Data</span>
                <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer bg-white px-2 py-1 rounded border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
                  <input type="checkbox" checked={showRawNmrData} onChange={(e) => setShowRawNmrData(e.target.checked)} className="accent-blue-600" /> Show Raw Data
                </label>
              </div>
              <div className="flex flex-col gap-6 items-center">
                {localTest.nmrTables.map((t, idx) => {
                  const cols = localTest.savedFits?.[t.id] || [];
                  return (
                    <div key={t.id} className="flex flex-col gap-3 w-full items-center">
                      {showRawNmrData && (
                        <div className="overflow-x-auto text-xs border border-slate-200 rounded flex flex-col items-center bg-slate-50 shadow-sm w-full">
                          <h5 className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 border-b border-slate-200 w-full text-center">
                            Table {idx + 1} Raw Data — {t.atom} ({t.relaxType})
                          </h5>
                          <table className="w-full text-center select-text bg-white" draggable="true">
                            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                              <tr>
                                <th className="px-3 py-1.5 border-r border-slate-200">{t.relaxType === 'DOSY' ? 'b-value' : 'Delay'} ({t.delayUnit})</th>
                                {Array.from({ length: t.nCols }, (_, c) => <th key={c} className="px-3 py-1.5">{t.colResidues[c] || `Col ${c + 1}`}</th>)}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {Array.from({ length: t.nRows }, (_, r) => (
                                <tr key={r}>
                                  <td className="px-3 py-1.5 font-mono text-slate-700 border-r border-slate-200">{t.delays[r] !== '' && t.delays[r] !== undefined ? t.delays[r] : '-'}</td>
                                  {Array.from({ length: t.nCols }, (_, c) => <td key={c} className="px-3 py-1.5 font-mono text-slate-600">{t.grid[r]?.[c] || '-'}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {cols.length > 0 && (
                        <div className="flex flex-col items-center bg-slate-50 w-full rounded border border-slate-200 pb-2 shadow-sm">
                          <h5 className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 border-b border-slate-200 w-full text-center mb-2">
                            Table {idx + 1} Fitted Parameters
                          </h5>
                          <ChunkedTable
                            data={cols.filter(cf => cf.fit)}
                            renderHeader={() => (
                              <tr>
                                <th className="px-3 py-1.5 border-r">Residue</th>
                                <th className="px-3 py-1.5 border-r">Rate (s⁻¹)</th>
                                <th className="px-3 py-1.5 border-r">Time (s)</th>
                                <th className="px-3 py-1.5">R²</th>
                              </tr>
                            )}
                            renderRow={(cf, i) => (
                              <tr key={i}>
                                <td className="px-3 py-1.5 font-mono text-slate-700 font-semibold border-r">{cf.residue}</td>
                                <td className="px-3 py-1.5 font-mono text-blue-700 border-r">
                                  {cf.fit.R_s ? cf.fit.R_s.toPrecision(4) : '-'}
                                  {cf.effectiveError ? ` ± ${cf.effectiveError.toPrecision(2)}` : ''}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-blue-700 border-r">
                                  {cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s ? cf.fit.T_s.toPrecision(4) : '-'}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-slate-600">{cf.fit.r2 ? cf.fit.r2.toFixed(3) : '-'}</td>
                              </tr>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {localTest.type === 'dosy' && Array.isArray(localTest.dosyTables) && localTest.dosyTables.length > 0 && (
            <div className="flex flex-col gap-4 mt-2 w-full">
              {localTest.dosyTables.map((t, ti) => (
                <div key={t.id} className="flex flex-col items-center w-full">
                  <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">
                    Gradient set {ti + 1} — Gradient % vs Intensity
                  </h5>
                  <div className="overflow-x-auto text-xs border border-slate-200 rounded bg-slate-50 shadow-sm w-full">
                    <table className="w-full text-left select-text bg-white">
                      <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-1.5 border-r border-slate-200">Gradient % (0–100)</th>
                          {Array.from({ length: t.nCols || 0 }, (_, c) => (
                            <th key={c} className="px-3 py-1.5 border-r border-slate-200">{t.colResidues?.[c] || `Col ${c + 1}`}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Array.from({ length: t.nRows || 0 }, (_, r) => (
                          <tr key={r}>
                            <td className="px-3 py-1.5 font-mono text-slate-700 border-r border-slate-200">{t.delays?.[r] ?? '-'}</td>
                            {Array.from({ length: t.nCols || 0 }, (_, c) => (
                              <td key={c} className="px-3 py-1.5 font-mono text-slate-600">{t.grid?.[r]?.[c] ?? '-'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
          {isMD && (
            <div className="flex flex-col gap-4 mt-2">
              <MDParamsPreview test={localTest} />
              <MDAtomTablePreview test={localTest} />
            </div>
          )}
        </RemovablePanel>

        {nbAnalysisPreviews && (
          <RemovablePanel title="Data Analysis Graphs" visible={showAnaLocal} setVisible={setShowAnaLocal}>
            {nbAnalysisPreviews.map((node, i) => (
              <div key={i}>{node(localTest, mockCtx)}</div>
            ))}
          </RemovablePanel>
        )}

        {showSimImgLocal && (
          <RemovablePanel title="Simulations & Generated Data" visible={showSimImgLocal} setVisible={setShowSimImgLocal}>
            {isCloning && localTest.sim && localTest.sim.sequence && (
              <CloningSimChartPreview sim={localTest.sim} />
            )}
            {isNMRFitting && (
              <NMRFittingSimPreview test={localTest} />
            )}
            {isNMR && selectedSpectrumTypes.length > 0 && (
              <div className="mt-4">
                <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">NMR Spectra (Simulated)</h5>
                <NMRSpectraPreview test={localTest} selectedTypes={selectedSpectrumTypes} />
              </div>
            )}
            {isCD && (
              <div className="mt-4">
                <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">CD Simulations</h5>
                <CDSimChartPreview test={localTest} />
              </div>
            )}
            {simImgList.length > 0 && (
              <div className="flex flex-col items-center gap-6 mt-4 pt-4 border-t border-slate-100 w-full">
                <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">Generic Simulation Images</h5>
                {simImgList.map((src, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-2 w-full">
                    <img src={getDirectImageUrl(normalizeImagePreview(src))} referrerPolicy="no-referrer" alt={`Sim ${idx}`} style={{ maxWidth: '100%', width: `${imageScale}%`, height: 'auto', maxHeight: '1125px', objectFit: 'contain' }} className="rounded-lg shadow-sm border border-slate-200 bg-white" />
                  </div>
                ))}
              </div>
            )}
            {!isNMRFitting && !(isCloning && localTest.sim?.sequence) && !(isNMR && selectedSpectrumTypes.length > 0) && !isCD && simImgList.length === 0 && (
               <p className="text-[10px] text-slate-400 italic">No simulation data available for this experiment.</p>
            )}
          </RemovablePanel>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
   LAB NOTEBOOK — MAIN COMPONENT
========================================================================== */
export const LabNotebook = ({ 
  tests, allCellLines, jumpToTest, allCmpds, operators,
  plasmidMeta, solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments, currentUser
}) => {
  const isSuperuser = currentUser?.role === 'superuser';
  const [filterPrimary, setFilterPrimary] = useState('ALL');
  const [filterSecondary, setFilterSecondary] = useState('ALL');
  const [filterScientist, setFilterScientist] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [filterCompound, setFilterCompound] = useState('ALL');
  const [filterPlasmid, setFilterPlasmid] = useState('ALL');
  const [filterCellLine, setFilterCellLine] = useState('ALL');
  const [filterProject, setFilterProject] = useState('ALL');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterSolvent, setFilterSolvent] = useState('ALL');
  const [filterBuffer, setFilterBuffer] = useState('ALL');
  const [filterAdditive, setFilterAdditive] = useState('ALL');
  const [filterInstrument, setFilterInstrument] = useState('ALL');
  const [filterProbe, setFilterProbe] = useState('ALL');
  const [filterPulseSeq, setFilterPulseSeq] = useState('ALL');

  const [dateFrom] = useState('');
  const [dateTo] = useState('');

  const [bestOnly, setBestOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  
  const [imageScale, setImageScale] = useState(50);

  // Display Toggles
  const [showConditions, setShowConditions] = useState(true);
  const [showMolecularFormula, setShowMolecularFormula] = useState(true);
  const [showInstrumental, setShowInstrumental] = useState(true);
  const [showReport, setShowReport] = useState(true);
  const [showImages, setShowImages] = useState(true);
  const [showData, setShowData] = useState(true);
  // Data-analysis graphs and simulated images are shown by default.
  const [showDataAnalysisGraphs, setShowDataAnalysisGraphs] = useState(true);
  const [showSimImages, setShowSimImages] = useState(true);
  
  // Option Lists
const primaryOptions = PRIMARY_CATEGORIES || Object.keys(CLASSIFICATION_MAP || {});
const secondaryOptions = useMemo(() => {
  if (filterPrimary === 'ALL' || !CLASSIFICATION_MAP) {
    const allSec = new Set();
    Object.values(CLASSIFICATION_MAP || {}).forEach(arr => arr.forEach(s => allSec.add(s)));
    return Array.from(allSec).sort();
  }
  return CLASSIFICATION_MAP[filterPrimary] || [];
}, [filterPrimary]);
const allScientists = useMemo(() => [...new Set([...operators, ...tests.map(t => t.operator)].filter(Boolean))].sort(), [tests, operators]);
  const allProjects = useMemo(() => [...new Set(tests.flatMap(t => t.projectNames || []))].filter(Boolean).sort(), [tests]);
  const allPlasmids = useMemo(() => Object.keys(plasmidMeta || {}).sort(), [plasmidMeta]);
  const allSolvents = useMemo(() => (solvents || []).map(s => s.name || s).filter(Boolean).sort(), [solvents]);
  const allBuffers = useMemo(() => (buffers || []).map(b => b.name || b).filter(Boolean).sort(), [buffers]);
  const allAdditives = useMemo(() => (additives || []).map(a => a.name || a).filter(Boolean).sort(), [additives]);
  const allInstruments = useMemo(() => (nmrInstruments || []).map(i => i.name || i).filter(Boolean).sort(), [nmrInstruments]);
  const allProbes = useMemo(() => (nmrProbes || []).map(p => p.name || p).filter(Boolean).sort(), [nmrProbes]);
  const allPulseSeqs = useMemo(() => (nmrExperiments || []).map(e => e.name || e).filter(Boolean).sort(), [nmrExperiments]);
  const [selectedSpectrumTypes, setSelectedSpectrumTypes] = useState(['hsqc']);

  const toggleSpectrumType = (id) =>
    setSelectedSpectrumTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  /* Experiment-type label + matching live in src/data/testTypes.js (ONE table
     for the whole app). The old local `typeLabels` map here had no entry for
     `microscopy`, so the “Experiment type → Microscopy” filter silently
     matched nothing. */
  const experimentTypeOptions = useMemo(() => experimentTypeFilterOptions(tests), [tests]);

  const filteredTests = useMemo(() => {
    // Helper: get all scientists assigned to a test (primary + co-scientists)
    const getTestScientists = (t) => {
      const all = [];
      if (t.operator) all.push(t.operator);
      if (Array.isArray(t.coScientists)) all.push(...t.coScientists);
      return all;
    };

    let result = tests.filter(t => {
      if (t.type === 'plate-9x9box') return false;

      // Normal users only see their own experiments (primary or co-scientist).
      // Unassigned tests (no scientists) are superuser-only.
      if (!isSuperuser && currentUser) {
        const scientists = getTestScientists(t);
        if (!scientists.includes(currentUser.name)) return false;
      }

      const flatCompounds = [...new Set([...(t.selectedCompounds || []), ...(t.compoundsSelected || []), ...(t.compound ? t.compound.split(',') : [])])].map(s => s.trim());
      const flatPlasmids = [...new Set([...(t.plasmids || []), ...(t.plasmid ? [t.plasmid] : [])])];

      if (filterPrimary !== 'ALL' && t.testCategory !== filterPrimary) return false;
      if (filterSecondary !== 'ALL' && t.secondaryCategory !== filterSecondary) return false;
      // Scientist filter: only active for superusers (normal users already pre-filtered above)
      if (isSuperuser && filterScientist !== 'ALL') {
        const scientists = getTestScientists(t);
        if (!scientists.includes(filterScientist)) return false;
      }
      if (!matchesExperimentTypeFilter(t, filterType)) return false;
      if (filterCompound !== 'ALL' && !flatCompounds.includes(filterCompound)) return false;
      if (filterPlasmid !== 'ALL' && !flatPlasmids.includes(filterPlasmid)) return false;
      if (filterCellLine !== 'ALL' && (!t.cellLines || !t.cellLines.includes(filterCellLine))) return false;
      if (filterProject !== 'ALL' && !(t.projectNames || []).includes(filterProject)) return false;

      if (showAdvanced) {
        const testStr = JSON.stringify(t).toLowerCase();
        
        if (filterSolvent !== 'ALL' && !testStr.includes(filterSolvent.toLowerCase())) return false;
        if (filterBuffer !== 'ALL' && !testStr.includes(filterBuffer.toLowerCase())) return false;
        if (filterAdditive !== 'ALL' && !testStr.includes(filterAdditive.toLowerCase())) return false;
        if (filterInstrument !== 'ALL' && !testStr.includes(filterInstrument.toLowerCase())) return false;
        if (filterProbe !== 'ALL' && !testStr.includes(filterProbe.toLowerCase())) return false;
        if (filterPulseSeq !== 'ALL' && !testStr.includes(filterPulseSeq.toLowerCase())) return false;
      }

      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (bestOnly && !t.bestMeasurement) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchable = JSON.stringify(t).toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });

    if (sortBy === 'date_desc') result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    else if (sortBy === 'date_asc') result.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    else if (sortBy === 'name') result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'type') result.sort((a, b) => (a.type || '').localeCompare(b.type || ''));

    return result;
  }, [tests, isSuperuser, currentUser, filterPrimary, filterSecondary, filterScientist, filterType, filterCompound, filterPlasmid, filterCellLine, filterProject, showAdvanced, filterSolvent, filterBuffer, filterAdditive, filterInstrument, filterProbe, filterPulseSeq, dateFrom, dateTo, bestOnly, searchQuery, sortBy]);

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto md:overflow-hidden custom-scrollbar">
      <div className="bg-white p-3 md:p-4 border-b border-slate-200 shadow-sm flex flex-col gap-3 no-print shrink-0">
        
        {/* TOP CONTROLS */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Search</label>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search all fields..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sort</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="date_desc">Date (newest)</option>
              <option value="date_asc">Date (oldest)</option>
              <option value="name">Name</option>
              <option value="type">Type</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pb-2">
            <input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} className="accent-amber-600 w-4 h-4" />
            ⭐ Best Only
          </label>
        </div>

        {/* MAIN FILTERS — all users see all filters except Scientist which is superuser-only */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
       <div>
         <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Main classification</label>
         <select value={filterPrimary} onChange={(e) => { setFilterPrimary(e.target.value); setFilterSecondary('ALL'); }} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
           <option value="ALL">All</option>
           {primaryOptions.map(c => <option key={c} value={c}>{c}</option>)}
         </select>
       </div>
       <div>
         <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sub-classification</label>
         <select value={filterSecondary} onChange={(e) => setFilterSecondary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
           <option value="ALL">All</option>
           {secondaryOptions.map(c => <option key={c} value={c}>{c}</option>)}
         </select>
       </div>
          {/* Scientist filter — superuser only */}
          {isSuperuser && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Scientist</label>
              <select value={filterScientist} onChange={(e) => setFilterScientist(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                <option value="ALL">All</option>
                {allScientists.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          {allProjects.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Project</label>
              <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                <option value="ALL">All</option>
                {allProjects.map(o => <option key={o} value={o}>📁 {o}</option>)}
              </select>
            </div>
          )}
<div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Experiment type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {experimentTypeOptions.map(label => <option key={label} value={label}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Compound</label>
            <SearchableSelect
              value={filterCompound}
              onChange={(v) => setFilterCompound(v)}
              options={allCmpds || []}
              placeholder="All"
              onClear={() => setFilterCompound('ALL')}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Plasmid</label>
            <SearchableSelect
              value={filterPlasmid}
              onChange={(v) => setFilterPlasmid(v)}
              options={allPlasmids || []}
              placeholder="All"
              onClear={() => setFilterPlasmid('ALL')}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Cell Line</label>
            <SearchableSelect
              value={filterCellLine}
              onChange={(v) => setFilterCellLine(v)}
              options={allCellLines || []}
              placeholder="All"
              onClear={() => setFilterCellLine('ALL')}
            />
          </div>
        </div>

        {/* Normal user info badge */}
        {!isSuperuser && currentUser && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            🧪 Showing your experiments — <strong>{currentUser.name}</strong>
          </div>
        )}

        {/* ADVANCED FILTERS toggle — all users */}
        <div>
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs font-bold text-blue-600 underline">
            {showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-slate-50 p-2 rounded border border-slate-200">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Solvent</label>
              <select value={filterSolvent} onChange={(e) => setFilterSolvent(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allSolvents.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Buffer</label>
              <select value={filterBuffer} onChange={(e) => setFilterBuffer(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allBuffers.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Additive</label>
              <select value={filterAdditive} onChange={(e) => setFilterAdditive(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allAdditives.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Instrument</label>
              <select value={filterInstrument} onChange={(e) => setFilterInstrument(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allInstruments.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NMR Probe</label>
              <select value={filterProbe} onChange={(e) => setFilterProbe(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allProbes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NMR Pulse Sequence</label>
              <select value={filterPulseSeq} onChange={(e) => setFilterPulseSeq(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allPulseSeqs.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* DISPLAY OPTIONS */}
        <div className="flex flex-wrap gap-2 items-center bg-blue-50 p-2 rounded border border-blue-100">
          <span className="text-[10px] font-bold text-blue-800 uppercase mr-2">Display Options:</span>
          
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showConditions} onChange={(e) => setShowConditions(e.target.checked)} className="accent-blue-600" /> Exp. Conditions
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showMolecularFormula} onChange={(e) => setShowMolecularFormula(e.target.checked)} className="accent-blue-600" /> Mol. Formula
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showInstrumental} onChange={(e) => setShowInstrumental(e.target.checked)} className="accent-blue-600" /> Instrumental Setup
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showReport} onChange={(e) => setShowReport(e.target.checked)} className="accent-blue-600" /> Report
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} className="accent-blue-600" /> Data
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showDataAnalysisGraphs} onChange={(e) => setShowDataAnalysisGraphs(e.target.checked)} className="accent-blue-600" /> Data Analysis Graphs
          </label>
          
          <div className="flex items-center gap-3 border-l border-blue-200 pl-3 ml-1 bg-white px-2 py-1 rounded shadow-sm">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showImages} onChange={(e) => setShowImages(e.target.checked)} className="accent-blue-600" /> Images
            </label>
            <div className="h-3 w-px bg-slate-200 mx-1"></div>
            <label className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
              🖼️ Size: {imageScale}%
            </label>
            <input type="range" min="20" max="200" step="10" value={imageScale} onChange={(e) => setImageScale(Number(e.target.value))} className="w-20 accent-blue-600" />
          </div>

          <div className="flex items-center gap-2 border-l border-blue-200 pl-2 ml-1">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showSimImages} onChange={(e) => setShowSimImages(e.target.checked)} className="accent-blue-600" /> Sim. Images
            </label>
            {showSimImages && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-slate-500 uppercase ml-1">NMR Spectra:</span>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.map((t) => t.id))} className="text-[9px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 shadow-sm">All</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.filter((t) => t.dim === '1D').map((t) => t.id))} className="text-[9px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 shadow-sm">1D</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.filter((t) => t.dim === '2D').map((t) => t.id))} className="text-[9px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 shadow-sm">2D</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes([])} className="text-[9px] font-bold bg-white border border-red-300 text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 shadow-sm">None</button>
                <div className="h-3 w-px bg-blue-200 mx-1"></div>
                {NMR_SPECTRUM_TYPES.map((st) => (
                  <label key={st.id} className="flex items-center gap-1 text-[9px] font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                    <input type="checkbox" checked={selectedSpectrumTypes.includes(st.id)} onChange={() => toggleSpectrumType(st.id)} className="accent-blue-600" />
                    {st.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

 <div id="lab-notebook-print-area" className="p-4 md:p-6 bg-slate-50 md:flex-1 md:overflow-y-auto md:min-h-0 custom-scrollbar">
        {/* Global image visibility CSS — covers ALL img tags including those in HTML content */}
        <style>{`
          #notebook-report-container img { display: ${showImages ? 'block' : 'none'} !important; }
          #notebook-report-container figure { display: ${showImages ? 'block' : 'none'} !important; }
          /* Uniform 12px character size in the notebook: avoids large headings
             mixed with tiny 9-11px labels. Applies to the whole report area. */
          #notebook-report-container, #notebook-report-container * { font-size: 12px !important; }
        `}</style>
        <div id="notebook-report-container" className="flex flex-col gap-4 max-w-5xl mx-auto">
          {filteredTests.length === 0 ? (
            <div className="text-center py-16 text-slate-400 italic bg-white rounded-xl border border-dashed border-slate-300">
              No experiments match the current filters.
            </div>
          ) : (
            <>
              <p className="text-[10px] text-slate-400 font-bold uppercase">{filteredTests.length} experiment(s) found</p>
              {filteredTests.map((test) => (
                <NotebookTestItem
                  key={test.id}
                  test={test}
                  tests={tests}
                  jumpToTest={jumpToTest}
                  showConditions={showConditions}
                  showMolecularFormula={showMolecularFormula}
                  showInstrumental={showInstrumental}
                  showReport={showReport}
                  showImages={showImages}
                  showData={showData}
                  showDataAnalysisGraphs={showDataAnalysisGraphs}
                  showSimImages={showSimImages}
                  selectedSpectrumTypes={selectedSpectrumTypes}
                  imageScale={imageScale}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabNotebook;
