import React, { useRef, useMemo, useCallback } from 'react';

import TestShellRenderer from './TestShellRenderer';
import { PLATE_TAB_CONFIG } from './tabConfigs';
import * as PlateSections from './PlateSections';
import { SharedGraphConfig, SharedErrorTreatment } from './SharedAnalysisTools';

/**
Plate tab — thin wrapper around the shared shell.

Common sections come from TestShellRenderer.
Plate-specific content comes from PlateSections.All.

IMPORTANT:
The shared shell uses compounds as metadata selection.
Plate uses activeTest.compounds as the column assignment array.

To avoid breaking the plate grid:
- expose selectedCompounds to the shell
- intercept shell compound updates
- store them in selectedCompounds / compoundsSelected
- do not overwrite activeTest.compounds
*/

const PLATE_NOTEBOOK_CHECKS = [
  { id: 'cond', label: 'Experimental Conditions' },
  { id: 'map', label: 'Plate Map Summary' },
  { id: 'ic50', label: 'IC50 Results' }
];

const PLATE_CONFIG = {
  ...PLATE_TAB_CONFIG,
  typeKey: 'plate',
  typeLabel: 'Plate Assay',
  icon: '🧫',
  samplesLabel: 'Compound / Sample Label(s)',
  notebookChecks: PLATE_NOTEBOOK_CHECKS,
  buildNotebookHtml: PlateSections.buildNotebookHtml,

  /*
  This makes the file compatible with both:
  - shells that use custom.All
  - shells that use config.SetupSection
  */
  SetupSection: PlateSections.All
};

export const PlateTestRenderer = (props) => {
  const plateModelRef = useRef({});

  const safeActiveTest = useMemo(() => {
    const t = props.activeTest || {};

    const selectedFromArray = Array.isArray(t.selectedCompounds)
      ? t.selectedCompounds.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const selectedFromLegacy = Array.isArray(t.compoundsSelected)
      ? t.compoundsSelected.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const selectedFromCompoundString = t.compound
      ? String(t.compound)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

    const selectedCompounds = Array.from(
      new Set([...selectedFromArray, ...selectedFromLegacy, ...selectedFromCompoundString])
    );

    return {
      ...t,
      selectedCompounds
    };
  }, [props.activeTest]);

  const safeUpdateActiveTest = useCallback(
    (updates) => {
      if (!updates) {
        props.updateActiveTest(updates);
        return;
      }

      /*
      If the shared shell updates compound metadata, it may send:
      {
        selectedCompounds: [...],
        compounds: [...],
        compound: "..."
      }

      For Plate, activeTest.compounds is the column assignment array,
      so we must NOT overwrite it.

      We therefore remove `compounds` from that specific metadata update
      and store the selection in `compoundsSelected`.
      */
      if (Object.prototype.hasOwnProperty.call(updates, 'selectedCompounds')) {
        const { compounds, ...rest } = updates;

        props.updateActiveTest({
          ...rest,
          compoundsSelected: updates.selectedCompounds
        });

        return;
      }

      props.updateActiveTest(updates);
    },
    [props.updateActiveTest]
  );

  return (
    <TestShellRenderer
      {...props}
      activeTest={safeActiveTest}
      updateActiveTest={safeUpdateActiveTest}
      config={PLATE_CONFIG}
      custom={PlateSections}
      plateModelRef={plateModelRef}
      testCategories={props.testCategories || PLATE_CONFIG.categories}
    />
  );
};

export default PlateTestRenderer;

/*
Compatibility exports for older imports, e.g. LabNotebook.jsx
*/
export { RegionCharts, ErrInput } from './PlateSections';
export { CollapsibleSection } from './TestShellRenderer';
