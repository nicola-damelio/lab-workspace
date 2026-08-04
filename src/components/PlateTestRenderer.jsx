import React, { useRef, useMemo, useCallback } from 'react';

import TestShellRenderer from './TestShellRenderer';
import { PLATE_TAB_CONFIG } from './tabConfigs';
import * as PlateSections from './PlateSections';

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
export const PlateTestRenderer = (props) => {
  const plateModelRef = useRef({});

  const safeActiveTest = useMemo(() => {
    const t = props.activeTest || {};

    return {
      ...t,
      selectedCompounds:
        t.selectedCompounds ||
        t.compoundsSelected ||
        []
    };
  }, [props.activeTest]);

  const safeUpdateActiveTest = useCallback(
    (updates) => {
      if (
        updates &&
        Object.prototype.hasOwnProperty.call(updates, 'selectedCompounds') &&
        Object.prototype.hasOwnProperty.call(updates, 'compounds')
      ) {
        const { compounds, ...rest } = updates;

        props.updateActiveTest({
          ...rest,
          compoundsSelected: updates.selectedCompounds
        });
      } else {
        props.updateActiveTest(updates);
      }
    },
    [props.updateActiveTest]
  );

  return (
    <TestShellRenderer
      {...props}
      activeTest={safeActiveTest}
      updateActiveTest={safeUpdateActiveTest}
      config={PLATE_TAB_CONFIG}
      custom={PlateSections}
      plateModelRef={plateModelRef}
      testCategories={props.testCategories || PLATE_TAB_CONFIG.categories}
    />
  );
};

export default PlateTestRenderer;
// Compatibility exports for LabNotebook.jsx and other old imports
export { RegionCharts, ErrInput } from './PlateTestRenderer_legacy';
export { CollapsibleSection } from './TestShellRenderer';
