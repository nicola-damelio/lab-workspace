import React, { useMemo, useRef } from 'react';
import TestShellRenderer from './TestShellRenderer';
import { SSNMR_TAB_CONFIG } from './tabConfigs';
import { All, InstrumentalSetup, NotebookExtra } from './ssNMRSections';

export const SSNMRTestRenderer = (props) => {
  const propsRef = useRef(props);
  propsRef.current = props;

  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : SSNMR_TAB_CONFIG.fallbackCategories;

  const config = useMemo(
    () => ({
      ...SSNMR_TAB_CONFIG,
      categories: appCategories,
      samples: { ...SSNMR_TAB_CONFIG.samples, cellLines: false }
    }),
    [appCategories]
  );

  const enrichCtx = useMemo(() => {
    return (ctxProps) => {
      const p = propsRef.current;

      // TestShellRenderer may pass the context either as:
      //   { ctx: {...} }
      // or directly as:
      //   { activeTest, updateActiveTest, ... }
      const base = ctxProps?.ctx || ctxProps || {};

      return {
        ...base,
        activeTest: base.activeTest || p.activeTest || null,
        updateActiveTest:
          typeof base.updateActiveTest === 'function'
            ? base.updateActiveTest
            : p.updateActiveTest,
        instances: Array.isArray(p.instances) ? p.instances : [],
        updateInstance:
          typeof p.updateInstance === 'function' ? p.updateInstance : null,
        compoundMeta: p.compoundMeta || {}
      };
    };
  }, []);

  const custom = useMemo(() => {
    const AllSection = function SSNMRAllSection(ctxProps) {
      return <All {...ctxProps} ctx={enrichCtx(ctxProps)} />;
    };

    const InstrumentalSetupSection = function SSNMRInstrumentalSetupSection(ctxProps) {
      return <InstrumentalSetup ctx={enrichCtx(ctxProps)} />;
    };

    const buildNotebookHtml = (checked, ctx) => {
      let html = '';

      const enhanced = enrichCtx({ ctx });

      if (checked.cond) {
        html += NotebookExtra({ ctx: enhanced, checkId: 'cond' });
      }

      if (checked.instrument) {
        html += NotebookExtra({ ctx: enhanced, checkId: 'instrument' });
      }

      if (checked.spectra) {
        html += NotebookExtra({ ctx: enhanced, checkId: 'spectra' });
      }

      if (checked.struct) {
        html += NotebookExtra({ ctx: enhanced, checkId: 'struct' });
      }

      return html;
    };

    return {
      All: AllSection,
      InstrumentalSetup: InstrumentalSetupSection,
      buildNotebookHtml
    };
  }, [enrichCtx]);

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={custom}
      testCategories={appCategories}
      datasetProtocols={props.datasetProtocols || []}
      jumpToProtocol={props.jumpToProtocol || null}
    />
  );
};

export default SSNMRTestRenderer;