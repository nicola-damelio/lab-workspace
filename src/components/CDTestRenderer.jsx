import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { CD_TAB_CONFIG } from './tabConfigs';
import { CDDataSection, MathAndFittingSection, FittingErrors, FittingGraphics, NotebookExtra } from './CDSections';

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
        Data: (ctxProps) => <CDDataSection {...ctxProps} ctx={{ ...ctxProps.ctx, instances: props.instances || [] }} />,
        Fitting: (ctxProps) => <MathAndFittingSection {...ctxProps} ctx={{ ...ctxProps.ctx, instances: props.instances || [] }} />,
        FittingErrors: (ctxProps) => <FittingErrors {...ctxProps} ctx={{ ...ctxProps.ctx, instances: props.instances || [] }} />,
        FittingGraphics: (ctxProps) => <FittingGraphics {...ctxProps} ctx={{ ...ctxProps.ctx, instances: props.instances || [] }} />,
        buildNotebookHtml: (checked, ctx) => {
          let html = '';
          const enhancedCtx = { ...ctx, instances: props.instances || [] };
          if (checked.cond) html += NotebookExtra({ ctx: enhancedCtx, checkId: 'cond' });
          if (checked.spectra) html += NotebookExtra({ ctx: enhancedCtx, checkId: 'spectra' });
          if (checked.struct) html += NotebookExtra({ ctx: enhancedCtx, checkId: 'table' });
          return html;
        }
      }}
      testCategories={appCategories}
    />
  );
};

export default CDTestRenderer;
