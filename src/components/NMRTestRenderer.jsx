import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { NMR_TAB_CONFIG } from './tabConfigs';
import * as NMRSections from './NMRSections';

/**
 * NMR tab — thin wrapper.
 * All shared sections (classification, samples, conditions, protocols, agenda,
 * comments, images, notebook export) come from TestShellRenderer.
 * NMR-specific UI (sequence, painting, structure, tables, simulated spectra)
 * comes from NMRSections via the config's custom slots.
 */
export const NMRTestRenderer = (props) => {
  return <TestShellRenderer {...props} config={NMR_TAB_CONFIG} custom={NMRSections} />;
};

export default NMRTestRenderer;
