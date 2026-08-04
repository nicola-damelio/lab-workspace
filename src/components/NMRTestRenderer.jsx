import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { NMR_TAB_CONFIG } from './tabConfigs';
import * as NMRSections from './NMRSections';

/**
 * NMR tab — thin wrapper around the shared shell.
 * Shared sections (classification, compounds, conditions, protocols, agenda,
 * comments, images, notebook export) come from TestShellRenderer.
 * NMR-specific content (setup, data, fitting, simulations) comes from NMRSections.
 */
export const NMRTestRenderer = (props) => {
  return <TestShellRenderer {...props} config={NMR_TAB_CONFIG} custom={NMRSections} />;
};

export default NMRTestRenderer;

