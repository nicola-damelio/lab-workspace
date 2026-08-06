import React, { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { CollapsibleSection, SmartImage } from './TestShellRenderer'; // Assuming these are exported

export const CloningDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  
  // State for manual UV data entry (mocking NanoDrop output)
  const [uvData, setUvData] = useState(activeTest.uvData || {
    conc: '',
    a260: '',
    a280: '',
    a230: '',
    ratio260_280: '',
    ratio260_230: ''
  });

  // Handle updates to the test object
  const handleUvChange = (field, value) => {
    const updated = { ...uvData, [field]: value };
    
    // Auto-calculate ratios if raw absorbances are provided
    if (updated.a260 && updated.a280) {
      updated.ratio260_280 = (parseFloat(updated.a260) / parseFloat(updated.a280)).toFixed(2);
    }
    if (updated.a260 && updated.a230) {
      updated.ratio260_230 = (parseFloat(updated.a260) / parseFloat(updated.a230)).toFixed(2);
    }
    
    setUvData(updated);
    updateActiveTest({ uvData: updated });
  };

  // Generate a mock spectrum array based on the A260 value for visual reference
  // In reality, this would be populated by importing a CSV from the NanoDrop
  const generateSpectrum = (a260) => {
    const peak = parseFloat(a260) || 1.0;
    const data = [];
    for (let wl = 220; wl <= 320; wl += 2) {
      // Simple Gaussian approximation for a DNA UV peak centered at 260nm
      const absorbance = peak * Math.exp(-Math.pow(wl - 260, 2) / (2 * Math.pow(12, 2)));
      // Add slight baseline drift to simulate realistic scatter
      const baseline = 0.05 + (320 - wl) * 0.002; 
      data.push({ wavelength: wl, absorbance: wl < 230 ? absorbance + peak * 0.8 : absorbance + baseline });
    }
    return data;
  };

  const spectrumData = generateSpectrum(uvData.a260);

  return (
    <div className="flex flex-col gap-6">
      <CollapsibleSection title="DNA Quantification (UV-Vis)" icon="💧">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Metrics Panel */}
          <div className="flex flex-col gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm">
            <h4 className="text-sm font-bold text-slate-700 uppercase border-b border-slate-200 pb-2">Yield & Purity</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Concentration (ng/µL)</label>
                <input 
                  type="number" 
                  value={uvData.conc} 
                  onChange={(e) => handleUvChange('conc', e.target.value)}
                  className="w-full border border-slate-300 rounded p-2 text-sm font-mono focus:border-blue-500"
                  placeholder="e.g. 150.5"
                />
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">A260 / A280</label>
                <div className={`w-full border rounded p-2 text-sm font-mono text-center font-bold ${
                  uvData.ratio260_280 >= 1.7 && uvData.ratio260_280 <= 1.9 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700' 
                  : uvData.ratio260_280 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-300'
                }`}>
                  {uvData.ratio260_280 || '—'}
                </div>
                <span className="text-[10px] text-slate-400 text-center block mt-1">Target: ~1.8</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">A260 / A230</label>
                <div className={`w-full border rounded p-2 text-sm font-mono text-center font-bold ${
                  uvData.ratio260_230 >= 2.0 && uvData.ratio260_230 <= 2.2 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700' 
                  : uvData.ratio260_230 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-300'
                }`}>
                  {uvData.ratio260_230 || '—'}
                </div>
                <span className="text-[10px] text-slate-400 text-center block mt-1">Target: 2.0 - 2.2</span>
              </div>
            </div>
            
            <div className="mt-2 text-[10px] text-slate-500 italic">
              * A low 260/280 indicates protein contamination. A low 260/230 indicates salt, phenol, or carbohydrate carryover.
            </div>
          </div>

          {/* Graph Panel */}
          <div className="lg:col-span-2 bg-white p-4 rounded-xl border border-slate-200 shadow-sm min-h-[300px]">
            <h4 className="text-sm font-bold text-slate-700 uppercase mb-4">UV Spectrum (Simulation / Imported)</h4>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={spectrumData} margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis 
                  dataKey="wavelength" 
                  type="number" 
                  domain={[220, 320]} 
                  tick={{ fontSize: 12, fill: '#64748b' }} 
                  label={{ value: 'Wavelength (nm)', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 12 }} 
                />
                <YAxis 
                  tick={{ fontSize: 12, fill: '#64748b' }} 
                  label={{ value: 'Absorbance (10 mm)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12 }} 
                />
                <Tooltip 
                  formatter={(value) => value.toFixed(3)} 
                  labelFormatter={(label) => `${label} nm`} 
                />
                <ReferenceLine x={260} stroke="#3b82f6" strokeDasharray="4 4" label={{ value: '260nm', position: 'top', fill: '#3b82f6', fontSize: 10 }} />
                <ReferenceLine x={280} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '280nm', position: 'top', fill: '#ef4444', fontSize: 10 }} />
                <Line type="monotone" dataKey="absorbance" stroke="#1e40af" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};
