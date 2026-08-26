/* =========================================================================
   src/components/AppModules/dashboardModule.jsx
   Dataset Overview (Dashboard) module, extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';

export const DashboardModule = ({ datasetTitle, datasetSubtitle, handlePrint, tests, storages, setCurrentModule, mergedPlan }) => (

              <div className="p-4 md:p-8 h-full overflow-y-auto custom-scrollbar bg-slate-50">
                <div className="max-w-6xl mx-auto">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 md:mb-8 border-b border-slate-200 pb-4 gap-4">
                    <div>
                      <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
                        {datasetTitle || 'Dataset Overview'}
                      </h1>

                      <p className="text-sm md:text-base text-slate-500 mt-1">
                        {datasetSubtitle ||
                          'Manage your experiments, inventory, and protocols.'}
                      </p>
                    </div>

                    <button
                      onClick={handlePrint}
                      className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print w-full md:w-auto justify-center"
                    >
                      🖨️ Print / Save PDF
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Total Tests
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {tests.filter((t) => t.type !== 'plate-9x9box').length}
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Stored Boxes
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {tests.filter((t) => t.type === 'plate-9x9box').length}
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Storage Units
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {storages.length}
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Upcoming Tasks
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {
                          mergedPlan.filter(
                            (t) => t.date >= new Date().toISOString().split('T')[0]
                          ).length
                        }
                      </div>
                    </div>
                  </div>

                  <h2 className="text-lg font-bold text-slate-700 mb-4">Quick Navigation</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      {
                        id: 'notebook',
                        icon: '📓',
                        title: 'Lab Notebook',
                        desc: 'Consolidated view of all experiment notes and results.'
                      },
                      {
                        id: 'definitions',
                        icon: '🏷️',
                        title: 'Definitions & Labels',
                        desc: 'Manage compounds, cell lines, and metadata fields.'
                      },
                      {
                        id: 'tests',
                        icon: '🧪',
                        title: 'Tests & Assays',
                        desc: 'Manage experimental plates, spectroscopic data, cloning, protein purification, and MD simulations.'
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
                      }
                    ].map((mod) => (
                      <button
                        key={mod.id}
                        onClick={() => setCurrentModule(mod.id)}
                        className="bg-white p-5 md:p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group no-print"
                      >
                        <div className="text-2xl mb-3 group-hover:scale-110 transition-transform duration-200">
                          {mod.icon}
                        </div>

                        <h3 className="font-bold text-slate-800 text-lg mb-1">{mod.title}</h3>

                        <p className="text-sm text-slate-500">{mod.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
);
