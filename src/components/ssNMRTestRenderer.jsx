import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { SSNMR_TAB_CONFIG } from './tabConfigs';
import { All, InstrumentalSetup, NotebookExtra } from './ssNMRSections';

export const ssNMRTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : SSNMR_TAB_CONFIG.fallbackCategories;

  const config = {
    ...SSNMR_TAB_CONFIG,
    categories: appCategories,
    samples: { ...SSNMR_TAB_CONFIG.samples, cellLines: false }
  };

  const enrichCtx = (ctxProps) => ({
    ...(ctxProps.ctx || {}),
    instances: props.instances || [],
    updateInstance: props.updateInstance || null,
    compoundMeta: props.compoundMeta || {}
  });

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        All: (ctxProps) => <All {...ctxProps} ctx={enrichCtx(ctxProps)} />,
        InstrumentalSetup: (ctxProps) => <InstrumentalSetup ctx={enrichCtx(ctxProps)} />,
        buildNotebookHtml: (checked, ctx) => {
          let html = '';
          const enhanced = {
            ...ctx,
            instances: props.instances || [],
            updateInstance: props.updateInstance || null,
            compoundMeta: props.compoundMeta || {}
          };
          if (checked.cond) html += NotebookExtra({ ctx: enhanced, checkId: 'cond' });
          if (checked.instrument) html += NotebookExtra({ ctx: enhanced, checkId: 'instrument' });
          if (checked.spectra) html += NotebookExtra({ ctx: enhanced, checkId: 'spectra' });
          if (checked.struct) html += NotebookExtra({ ctx: enhanced, checkId: 'struct' });
          return html;
        }
      }}
      testCategories={appCategories}
    />
  );
};

export default ssNMRTestRenderer;