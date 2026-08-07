import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { CD_TAB_CONFIG } from './tabConfigs';
import { All, NotebookExtra } from './CDSections';

export const CDTestRenderer = (props) => {
  // Categories defined in App → Definitions & Labels take priority
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : CD_TAB_CONFIG.categories || [
          'Activity', 'Toxicity', 'Structure', 'Binding', 'Characterization'
        ];

  const config = { ...CD_TAB_CONFIG, categories: appCategories };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        All,
        buildNotebookHtml: (checked, ctx) => {
          let html = '';
          if (checked.cond) html += NotebookExtra({ ctx, checkId: 'cond' });
          if (checked.spectra) html += NotebookExtra({ ctx, checkId: 'spectra' });
          if (checked.struct) html += NotebookExtra({ ctx, checkId: 'table' });
          return html;
        }
      }}
      testCategories={appCategories}
    />
  );
};

export default CDTestRenderer;
