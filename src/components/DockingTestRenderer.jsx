import React, { useMemo } from 'react';
import TestShellRenderer from './TestShellRenderer';

import {
  buildNotebookHtml as buildDockingNotebookHtmlFromSections,
  DockingExperimentSetupSection,
  DockingDataSection,
  DockingAnalysisSection,
  DockingParametersSection
} from './DockingSections';

/* ============================================================================
   DockingTestRenderer — self-contained docking test page renderer.
   Structurally identical to MDTestRenderer.jsx, adapted for docking.
============================================================================ */

export const DOCKING_TAB_CONFIG = {
  typeKey: 'docking',
  typeLabel: 'Molecular Docking',
  icon: '🎯',
  fallbackCategories: [
    'Blind Docking',
    'Focused Docking',
    'Flexible Docking',
    'Ensemble Docking',
    'Protein–Protein Docking',
    'Virtual Screening'
  ],
  samples: {
    compounds: true,
    cellLines: false,
    compoundLabel: 'Receptor / Ligand Label(s)',
    cellLineLabel: 'Biological Models'
  },
  imagesKey: 'dockingImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Docking Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 10', units: ['µM', 'mM', 'nM'] },

    { key: 'dockingProgram', label: 'Docking Program', type: 'text', placeholder: 'e.g. AutoDock Vina' },
    { key: 'scoringFunction', label: 'Scoring Function', type: 'text', placeholder: 'e.g. Vina' },
    { key: 'searchAlgorithm', label: 'Search Algorithm', type: 'text', placeholder: 'e.g. Lamarckian GA' },
    { key: 'exhaustiveness', label: 'Exhaustiveness', type: 'text', placeholder: 'e.g. 8' },
    { key: 'numModes', label: 'Num Modes', type: 'text', placeholder: 'e.g. 9' },
    { key: 'boxCenter', label: 'Box Center', type: 'text', placeholder: 'x, y, z' },
    { key: 'boxSize', label: 'Box Size', type: 'text', placeholder: 'x, y, z', units: ['Å'] },
    { key: 'bestAffinity', label: 'Best Affinity', type: 'text', placeholder: 'e.g. -8.5', units: ['kcal/mol'] }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Docking Parameters' },
    { id: 'seq', label: 'Receptor / Ligand' },
    { id: 'table', label: 'Results Table' },
    { id: 'formula', label: 'Chemical Formula' }
  ]
};

// ================= ERROR BOUNDARY =================
class DockingErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('DockingTestRenderer error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 bg-red-50 border-2 border-red-400 rounded-xl m-6">
          <h2 className="text-red-700 font-black text-lg mb-2">❌ DockingTestRenderer crashed</h2>
          <pre className="text-red-600 text-xs whitespace-pre-wrap overflow-auto max-h-64">
            {String((this.state.error && this.state.error.message) || this.state.error)}
            {'\n\n'}
            {String((this.state.error && this.state.error.stack) || '')}
          </pre>
          <p className="text-red-500 text-xs mt-2">Copy this error and share it so we can fix the exact line.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ================= MAIN RENDERER =================
const DockingTestRenderer = ({
  activeTest,
  updateActiveTest,
  TestHeader,
  datasetProtocols,
  jumpToProtocol,
  allCmpds,
  allCellLines,
  customFields,
  testCategories,
  ...rest
}) => {
  const custom = useMemo(
    () => ({
      MolecularStructure: DockingExperimentSetupSection,
      Simulations: DockingParametersSection,
      Data: DockingDataSection,
      Analysis: DockingAnalysisSection,
      buildNotebookHtml:
        typeof buildDockingNotebookHtmlFromSections === 'function'
          ? (checked, ctxArg) => buildDockingNotebookHtmlFromSections(ctxArg, checked)
          : () => ''
    }),
    []
  );

  return (
    <DockingErrorBoundary>
      <TestShellRenderer
        config={DOCKING_TAB_CONFIG}
        custom={custom}
        activeTest={activeTest}
        updateActiveTest={updateActiveTest}
        TestHeader={TestHeader}
        datasetProtocols={datasetProtocols}
        jumpToProtocol={jumpToProtocol}
        allCmpds={allCmpds}
        allCellLines={allCellLines}
        customFields={customFields}
        testCategories={testCategories}
        {...rest}
      />
    </DockingErrorBoundary>
  );
};

export default DockingTestRenderer;