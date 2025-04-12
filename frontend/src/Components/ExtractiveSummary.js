"use client";

import React, { useState } from "react";
import { ListChecks, CheckCircle2, Scissors, Download, Volume2, AlertTriangle, ListOrdered, ChevronRight } from "lucide-react";
import PropTypes from 'prop-types';
import axios from 'axios';

// Use backend URL from environment variable or default
const backendURL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const ExtractiveSummary = ({ 
  summary = [],
  maxPoints = 5,
  filePath
}) => {
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimmedFile, setTrimmedFile] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Process the summary to ensure it's an array and has items
  const processedSummary = Array.isArray(summary) 
    ? summary.filter(item => item && 
                    typeof item === 'string' && 
                    item.trim() !== "" && 
                    !item.startsWith("Error:") && 
                    !item.includes("Error generating extractive summary") &&
                    !item.includes("timed out") &&
                    !item.includes("skipped"))
    : [];
    
  // Check if summary contains error messages
  const hasError = Array.isArray(summary) && 
                   summary.some(item => item && 
                                typeof item === 'string' && 
                                (item.startsWith("Error:") || 
                                 item.includes("Error generating extractive summary") ||
                                 item.includes("timed out") ||
                                 item.includes("skipped")));
    
  if (!processedSummary.length) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
        <div className="flex items-center mb-4">
          <ListOrdered className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Key Points</h2>
        </div>
        <div className="text-slate-400 text-sm p-3 bg-slate-800/70 rounded-lg border border-slate-700/50">
          {hasError ? (
            <div className="flex items-start">
              <AlertTriangle size={16} className="text-amber-400 mr-2 mt-0.5 flex-shrink-0" />
              <p className="text-amber-300">Unable to generate key points for this content.</p>
            </div>
          ) : (
            <p className="flex items-center">
              <ListOrdered className="mr-2 text-slate-500" size={16} />
              No key points available.
            </p>
          )}
        </div>
      </div>
    );
  }
  
  // Get the displayed summary points, limited by maxPoints if not expanded
  const displayedSummary = expanded 
    ? processedSummary 
    : processedSummary.slice(0, maxPoints);
  
  const handleTrimAudio = async () => {
    if (!filePath) {
      setError("No file path available. Please make sure the audio is processed first.");
      return;
    }

    setIsTrimming(true);
    setError(null);
    
    try {
      // Create form data for the request
      const formData = new FormData();
      formData.append('file_path', filePath);
      
      // Add each summary point as a separate form field with the same name
      processedSummary.forEach(point => {
        formData.append('summary_points', point);
      });
      
      // Default padding of 3 seconds
      formData.append('padding_seconds', 3.0);
      
      // Send the request to the backend
      const response = await axios.post(`${backendURL}/trim_by_summary`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      // Handle success
      if (response.data && response.data.trimmed_file) {
        setTrimmedFile(response.data.trimmed_file);
      } else {
        setError("Trimming completed, but no file was returned.");
      }
    } catch (error) {
      console.error("Error trimming audio:", error);
      setError(error.response?.data?.detail || error.message || "An error occurred while trimming the audio.");
    } finally {
      setIsTrimming(false);
    }
  };
  
  const getTrimmedFileUrl = () => {
    if (!trimmedFile) return '';
    return `${backendURL}/static/${trimmedFile}`;
  };
  
  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <ListOrdered className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Key Points</h2>
        </div>
        {processedSummary.length > maxPoints && (
          <button 
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            {expanded ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
      
      <div className="space-y-3">
        {displayedSummary.map((item, index) => (
          <div key={index} className="flex items-start gap-3 p-3 bg-slate-800/40 rounded-lg border border-slate-700/30 hover:bg-slate-800/60 transition-colors group">
            <div className="mt-0.5">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-medium">
                {index + 1}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-slate-300 text-sm leading-relaxed">{item.text || item}</p>
              {item.timestamp && (
                <div className="mt-2 flex items-center text-xs text-slate-500">
                  <span>{formatTimestamp(item.timestamp)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {!expanded && processedSummary.length > maxPoints && (
          <button 
            onClick={() => setExpanded(true)}
            className="w-full py-2 flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-slate-300 bg-slate-800/40 rounded-lg border border-slate-700/30 hover:bg-slate-800/60 transition-colors"
          >
            <span>Show {processedSummary.length - maxPoints} more points</span>
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

// Helper to format timestamp
const formatTimestamp = (timestamp) => {
  if (!timestamp) return "";
  
  try {
    const totalSeconds = typeof timestamp === 'number' ? timestamp : parseFloat(timestamp);
    if (isNaN(totalSeconds)) return "";
    
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } catch (e) {
    return "";
  }
};

ExtractiveSummary.propTypes = {
  summary: PropTypes.oneOfType([
    PropTypes.array,
    PropTypes.object
  ]),
  maxPoints: PropTypes.number
};

export default ExtractiveSummary; 