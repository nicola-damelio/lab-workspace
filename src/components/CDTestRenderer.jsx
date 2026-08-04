import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { CD_TAB_CONFIG } from './tabConfigs';
import * as CDSections from './CDSections';

export const CDTestRenderer = (props) => (
  <TestShellRenderer {...props} config={CD_TAB_CONFIG} custom={CDSections} />
);

export default CDTestRenderer;
