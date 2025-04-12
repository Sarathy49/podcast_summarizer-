"use client";

import React from "react";
import { Layers, AlertTriangle } from "lucide-react";
import PropTypes from 'prop-types';

const AbstractiveSummary = ({ 
  summary = {
    text: '',
    confidence: 0,
    model: ''
  }
}) => {
  // Remove any empty items from summary array
  const processedSummary = Array.isArray(summary) 
    ? summary.filter(s => s && typeof s === 'string' && s.trim() !== '')
    : typeof summary === 'string' 
      ? summary 
      : summary?.text || '';
  
  // Convert to string if needed
  const summaryText = typeof processedSummary === 'string' 
    ? processedSummary 
    : Array.isArray(processedSummary) 
      ? processedSummary.join('\n\n') 
      : '';
      
  // Check if summary contains an error message
  const hasError = summaryText.startsWith('Error:') || 
                  summaryText.includes('Error generating abstractive summary') ||
                  summaryText.includes('timed out') ||
                  summaryText.includes('skipped');
  
  if (!summaryText || hasError) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
        <div className="flex items-center mb-4">
          <Layers className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Abstractive Summary</h2>
        </div>
        <div className="text-slate-400 text-sm p-3 bg-slate-800/70 rounded-lg border border-slate-700/50">
          {hasError ? (
            <div className="flex items-start">
              <AlertTriangle size={16} className="text-amber-400 mr-2 mt-0.5 flex-shrink-0" />
              <p className="text-amber-300">Unable to generate summary for this content.</p>
            </div>
          ) : (
            <p>No abstractive summary available.</p>
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
      <div className="flex items-center mb-4">
        <Layers className="mr-3 text-blue-400" size={18} />
        <h2 className="text-lg font-medium text-slate-200">Abstractive Summary</h2>
      </div>
      
      <div className="prose prose-sm prose-invert max-w-none">
        <p className="text-slate-300 leading-relaxed">
          {summaryText}
        </p>
      </div>
      
      {summary.model && (
        <div className="mt-4 flex items-center justify-start gap-2">
          <span className="text-xs text-slate-500">Generated with {summary.model}</span>
        </div>
      )}
    </div>
  );
};

AbstractiveSummary.propTypes = {
  summary: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.arrayOf(PropTypes.string),
    PropTypes.shape({
      text: PropTypes.string,
      confidence: PropTypes.number,
      model: PropTypes.string
    })
  ])
};

export default AbstractiveSummary; 