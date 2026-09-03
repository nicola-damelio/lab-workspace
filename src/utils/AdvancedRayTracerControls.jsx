import React, { useState, useEffect } from 'react';

const SLIDER_DEFS = [
  { key: 'azimuth', label: 'Azimuth', min: 0, max: 360, fmt: (v) => `${v}°`, step: 1 },
  { key: 'elevation', label: 'Elevation', min: -90, max: 90, fmt: (v) => `${v}°`, step: 1 },
  { key: 'drama', label: 'Shadow contrast', min: 0, max: 100, fmt: (v) => `${Math.round(v)}%`, step: 1, scale: 100 },
  { key: 'specular', label: 'Specular', min: 0, max: 100, fmt: (v) => `${Math.round(v)}%`, step: 1, scale: 100 },
  { key: 'shadowSoftness', label: 'Softness', min: 0, max: 100, fmt: (v) => `${Math.round(v)}%`, step: 1, scale: 100 }
];

const AdvancedRayTracerControls = ({ compact = true } = {}) => {
  const [settings, setSettings] = useState({
    azimuth: 135,
    elevation: 30,
    drama: 0.7,
    specular: 0.6,
    shadowSoftness: 0.3
  });

  useEffect(() => {
    window.__rayTraceSettings = settings;
  }, [settings]);

  const updateSetting = (key, rawValue, scale = 1) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: (scale ? Number(rawValue) / scale : Number(rawValue)) };
      window.__rayTraceSettings = next;
      try { window.dispatchEvent(new CustomEvent('lab:ray-settings-changed', { detail: next })); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[10px]">
      <span className="font-black text-slate-600 uppercase tracking-wide whitespace-nowrap border-r border-slate-200 pr-3">
        ⚡ Ray lighting
      </span>
      {SLIDER_DEFS.map((def) => {
        const raw = def.scale ? settings[def.key] * def.scale : settings[def.key];
        return (
          <label key={def.key} className="flex items-center gap-1.5 whitespace-nowrap" title={`${def.label}: ${def.fmt(raw)}`}>
            <span className="text-slate-500 font-semibold">{def.label}</span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step || 1}
              value={Math.round(raw)}
              onChange={(e) => updateSetting(def.key, e.target.value, def.scale || 1)}
              className="w-24 accent-blue-600 cursor-pointer"
            />
            <span className="text-slate-600 font-bold w-9">{def.fmt(Number(raw))}</span>
          </label>
        );
      })}
    </div>
  );
};

export default AdvancedRayTracerControls;
