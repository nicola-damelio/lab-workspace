/* =========================================================================
   src/components/AppModules/agendaModule.jsx
   Project Timeline (Agenda) module, extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';

export const AgendaModule = ({
  currentUser, agendaOpFilter, setAgendaOpFilter, operatorNames,
  mergedPlan, calFilterDate, setCalFilterDate, agendaGrouped, jumpToTest,
  currentMonth, monthName, startDayOffset, totalDays,
  handlePrevMonth, handleNextMonth, handlePrint
}) => (

              <div className="p-4 md:p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
                <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-4 gap-4">
                  <div>
                    <h2 className="text-xl md:text-2xl font-black text-slate-800">
                      Project Timeline
                    </h2>

                    <p className="text-sm text-slate-500">
                      Aggregated view of all tasks scheduled across tests.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
<div className="flex flex-col gap-1">
  <label className="text-[10px] font-bold text-slate-500 uppercase">Filter by Scientist</label>
  {currentUser?.role === 'superuser' ? (
    <select value={agendaOpFilter} onChange={(e) => setAgendaOpFilter(e.target.value)}
      className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold shadow-sm">
      <option value="ALL">All Users</option>
      {(operatorNames || []).map((op) => (<option key={`agenda-${op}`} value={op}>{op}</option>))}
    </select>
  ) : (
    <div className="text-sm font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5">
      🧪 {currentUser?.name || 'You'}
    </div>
  )}
</div>
                    <button
                      onClick={handlePrint}
                      className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print self-end"
                    >
                      🖨️ Print / Save PDF
                    </button>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-80 bg-white border border-slate-200 rounded-xl p-4 shadow-sm shrink-0 h-fit no-print">
                    <div className="flex justify-between items-center mb-4">
                      <button
                        onClick={handlePrevMonth}
                        className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded hover:bg-slate-50 transition-colors"
                      >
                        ◀
                      </button>

                      <h3 className="text-sm font-bold text-slate-700">{monthName}</h3>

                      <button
                        onClick={handleNextMonth}
                        className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded hover:bg-slate-50 transition-colors"
                      >
                        ▶
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center mb-2">
                      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                        <div key={i} className="text-[11px] font-bold text-slate-400">
                          {d}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: startDayOffset }).map((_, i) => (
                        <div key={`empty-${i}`}></div>
                      ))}

                      {Array.from({ length: totalDays }, (_, i) => {
                        const day = String(i + 1).padStart(2, '0');
                        const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
                        const dateStr = `${currentMonth.getFullYear()}-${month}-${day}`;
                        const hasTask = mergedPlan.some((p) => p.date === dateStr);
                        const isSel = calFilterDate === dateStr;

                        return (
                          <button
                            key={i}
                            onClick={() => setCalFilterDate(isSel ? null : dateStr)}
                            className={`text-[11px] py-1.5 rounded-md transition-all font-medium ${
                              isSel
                                ? 'bg-blue-600 text-white shadow-md scale-105'
                                : hasTask
                                ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>

                    {calFilterDate && (
                      <button
                        onClick={() => setCalFilterDate(null)}
                        className="mt-4 w-full text-xs text-red-500 font-bold hover:bg-red-50 py-2 rounded transition-colors"
                      >
                        Clear Filter
                      </button>
                    )}
                  </div>

                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4 md:p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-700 mb-4 border-b border-slate-100 pb-2">
                      {calFilterDate ? `Tasks for ${calFilterDate}` : 'All Scheduled Tasks'}
                    </h3>

                    <div className="flex flex-col gap-4">
                      {Object.keys(agendaGrouped).length === 0 ? (
                        <div className="text-center text-slate-400 py-10 italic">
                          No tasks planned across any test.
                        </div>
                      ) : (
                        (calFilterDate
                          ? agendaGrouped[calFilterDate]
                            ? [[calFilterDate, agendaGrouped[calFilterDate]]]
                            : []
                          : Object.entries(agendaGrouped)
                        ).map(([date, tasks]) => (
                          <div key={date} className="flex flex-col">
                            <h4 className="font-bold text-sm text-slate-500 mb-2">{date}</h4>

                            <div className="flex flex-col gap-2">
                              {tasks.map((t, idx) => (
                                <div
                                  key={idx}
                                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 bg-slate-50 p-3 border border-slate-200 rounded-lg group hover:border-blue-300 transition-colors"
                                >
                                  <button
                                    onClick={() => jumpToTest(t.testId)}
                                    className="text-xs font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shadow-sm self-start md:self-auto"
                                  >
                                    {t.testName}
                                  </button>

                                  <span className="text-sm text-slate-700 flex-1">{t.task}</span>
                                  {t.assignedTo && (
                                    <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">{t.assignedTo}</span>
                                  )}
                                  {!t.assignedTo && t.testOperator && (
                                    <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full whitespace-nowrap">{t.testOperator}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
);
