/* =========================================================================
   src/components/AppModules/dashboardModule.jsx
   Dataset Overview (Dashboard) module, extracted from App.jsx. Props-only.
   ========================================================================= */

import React, { useState } from 'react';
import { Icon } from '../Icons';
import { loadProjects } from './projectsModule';

export const DashboardModule = ({ datasetTitle, setDatasetTitle, datasetSubtitle, handlePrint, tests, storages, setCurrentModule, mergedPlan }) => {
  // Count only the projects that belong to the currently open dataset.
  const [projectCount] = useState(() => {
    try {
      return loadProjects().length;
    } catch { return 0; }
  });

  return (

              <div className="p-4 md:p-8 h-full overflow-y-auto custom-scrollbar bg-slate-50">
                <div className="max-w-6xl mx-auto">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-3 border-b border-slate-200 pb-2 gap-2">
                    <div>
                      <input
                        value={datasetTitle || ''}
                        onChange={(e) => setDatasetTitle(e.target.value)}
                        placeholder="Dataset Title"
                        title="Rename the dataset — the Drive folder follows automatically"
                        className="text-lg md:text-xl font-bold text-slate-800 bg-transparent border-b border-dashed border-transparent hover:border-slate-300 focus:border-blue-400 outline-none w-full md:w-auto max-w-full truncate"
                      />

                      <p className="text-xs md:text-sm text-slate-500 mt-0.5">
                        {datasetSubtitle ||
                          'Manage your experiments, inventory, and protocols.'}
                      </p>
                    </div>

                    <button
                      onClick={handlePrint}
                      className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-1.5 px-3 rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-sm no-print w-full md:w-auto justify-center"
                    >
                      <Icon name="printer" size={14} /> Print / Save PDF
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4">
                    <div className="bg-white p-2.5 md:p-3 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                        Total Tests
                      </div>

                      <div className="text-lg md:text-xl font-bold text-slate-800">
                        {tests.filter((t) => t.type !== 'plate-9x9box').length}
                      </div>
                    </div>

                    <div className="bg-white p-2.5 md:p-3 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                        Stored Boxes
                      </div>

                      <div className="text-lg md:text-xl font-bold text-slate-800">
                        {tests.filter((t) => t.type === 'plate-9x9box').length}
                      </div>
                    </div>

                    <div className="bg-white p-2.5 md:p-3 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                        Storage Units
                      </div>

                      <div className="text-lg md:text-xl font-bold text-slate-800">
                        {storages.length}
                      </div>
                    </div>

                    <div className="bg-white p-2.5 md:p-3 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                        Upcoming Tasks
                      </div>

                      <div className="text-lg md:text-xl font-bold text-slate-800">
                        {
                          mergedPlan.filter(
                            (t) => t.date >= new Date().toISOString().split('T')[0]
                          ).length
                        }
                      </div>
                    </div>

                    <div className="bg-white p-2.5 md:p-3 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                        Projects
                      </div>

                      <div className="text-lg md:text-xl font-bold text-slate-800">
                        {projectCount}
                      </div>
                    </div>
                  </div>

                  <h2 className="text-sm font-bold text-slate-700 mb-2">Quick Navigation</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[
                      {
                        id: 'projects',
                        icon: '📁',
                        title: 'Projects',
                        desc: 'Scientific background, experiments, results and discussion, conclusions and references.'
                      },
                      {
                        id: 'tests',
                        icon: '🧪',
                        title: 'Experiments',
                        desc: 'Manage experimental plates, spectroscopic data, cloning, protein purification, and MD simulations.'
                      },
                      {
                        id: 'notebook',
                        icon: '📓',
                        title: 'Lab Notebook',
                        desc: 'Consolidated view of all experiment notes and results.'
                      },
                      {
                        id: 'library',
                        icon: '📚',
                        title: 'Library',
                        desc: 'Manage compounds, cell lines, plasmids, solvents, buffers, additives, and NMR equipment.'
                      },
                      {
                        id: 'agenda',
                        icon: '🗓️',
                        title: 'Project Agenda',
                        desc: 'Timeline of all scheduled experimental tasks.'
                      },
                      {
                        id: 'protocols',
                        icon: '📝',
                        title: 'Protocols Library',
                        desc: 'Draft, store, and link experimental procedures.'
                      },
                      {
                        id: 'storage',
                        icon: '📦',
                        title: 'Storage & Inventory',
                        desc: 'Track physical boxes and storage locations.'
                      },
                      {
                        id: 'calculations',
                        icon: '🧮',
                        title: 'Calculations',
                        desc: 'Mass, volume, and preparation calculators.'
                      },
                      {
                        id: 'publications',
                        icon: '📰',
                        title: 'Publications & Journals',
                        desc: 'Target journals, impact factors, links and notes.'
                      },
                      {
                        id: 'image-builder',
                        icon: '🖼️',
                        title: 'Image Builder',
                        desc: 'Compose publication-quality multi-panel figures from your experiment graphs and images.'
                      },
                      {
                        id: 'settings',
                        icon: '⚙️',
                        title: 'Settings',
                        desc: 'Scientists, custom metadata fields, database cleanup, and Drive file management.'
                      }
                    ].map((mod) => (
                      <button
                        key={mod.id}
                        onClick={() => setCurrentModule(mod.id)}
                        className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group no-print"
                      >
                        <div className="mb-1 group-hover:scale-110 transition-transform duration-200 text-blue-600">
                          <Icon name={mod.icon} size={26} />
                        </div>

                        <h3 className="font-bold text-slate-800 text-sm mb-0.5">{mod.title}</h3>

                        <p className="text-xs text-slate-500">{mod.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
);
  };
