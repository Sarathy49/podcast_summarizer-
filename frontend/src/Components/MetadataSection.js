"use client";

import React, { useState } from "react";
import { Clock, FileAudio, Calendar, BookOpen, Users, Tag, HardDrive, Settings, Info, Music, Hash, Globe, File, Share2 } from "lucide-react";
import PropTypes from 'prop-types';

const MetadataSection = ({ 
  metadata = {
    title: '',
    duration: 0,
    file_size: 0,
    file_type: '',
    audio_url: '',
    created_at: ''
  },
  title = null
}) => {
  if (!metadata) return null;

  const [isExpanded, setIsExpanded] = useState(false);
  
  // Ensure we have valid metadata to display
  if (!metadata || typeof metadata !== 'object') {
    return (
      <div className="p-6 bg-slate-800/60 rounded-xl border border-slate-700/50">
        <div className="text-center text-slate-400">No metadata available</div>
      </div>
    );
  }

  // Extract key metadata
  const { 
    title: metadataTitle = "Unknown Title", 
    duration: metadataDuration = "00:00", 
    file_size: filesize = "", 
    file_type: format = "", 
    created_at: date = "", 
    bitrate = "",
  } = metadata;

  // Determine which title to use - prefer provided title, fallback to metadata title
  const displayTitle = title || metadataTitle;

  // Formats seconds into HH:MM:SS format
  const formatDuration = (seconds) => {
    if (!seconds) return "00:00";
    
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (hrs > 0) {
      parts.push(String(hrs).padStart(2, '0'));
    }
    parts.push(String(mins).padStart(2, '0'));
    parts.push(String(secs).padStart(2, '0'));
    
    return parts.join(':');
  };
  
  // Format filesize
  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    if (typeof bytes === 'string') {
      // If it's already formatted, return as is
      return bytes;
    }
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
  };
  
  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateString;
    }
  };

  const formattedDuration = typeof metadataDuration === 'number' 
    ? formatDuration(metadataDuration) 
    : metadataDuration;

  // Cards and header configurations
  return (
    <div className="space-y-6">
      {/* Title Section with Gradient Border */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-violet-500/5 blur-lg rounded-xl opacity-60"></div>
        <div className="relative bg-slate-800/60 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5 shadow-lg">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3 truncate">{displayTitle}</h1>
          
          {/* Audio Duration Badge */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 px-3 py-1.5 rounded-full flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1.5" />
              <span className="text-sm font-medium">{formattedDuration}</span>
            </div>
            
            {format && (
              <div className="bg-purple-500/10 border border-purple-500/20 text-purple-300 px-3 py-1.5 rounded-full flex items-center">
                <File className="w-3.5 h-3.5 mr-1.5" />
                <span className="text-sm font-medium">{format.toUpperCase()}</span>
              </div>
            )}
            
            {filesize && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-3 py-1.5 rounded-full flex items-center">
                <Hash className="w-3.5 h-3.5 mr-1.5" />
                <span className="text-sm font-medium">{formatFileSize(filesize)}</span>
              </div>
            )}
            
            {date && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 px-3 py-1.5 rounded-full flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
                <span className="text-sm font-medium">{formatDate(date)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Additional details that can be expanded */}
      {(bitrate || metadata.sample_rate || metadata.channels) && (
        <div className="mt-5">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-slate-400 hover:text-slate-300 flex items-center gap-1"
          >
            {isExpanded ? 'Hide details' : 'Show more details'}
          </button>
          
          {isExpanded && (
            <div className="mt-3 p-3 bg-slate-700/20 rounded-lg border border-slate-700/30 text-sm space-y-2 text-slate-300">
              {bitrate && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Bitrate:</span>
                  <span>{bitrate}</span>
                </div>
              )}
              {metadata.sample_rate && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Sample Rate:</span>
                  <span>{metadata.sample_rate}</span>
                </div>
              )}
              {metadata.channels && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Channels:</span>
                  <span>{metadata.channels}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

MetadataSection.propTypes = {
  metadata: PropTypes.shape({
    title: PropTypes.string,
    duration: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    file_size: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    file_type: PropTypes.string,
    audio_url: PropTypes.string,
    created_at: PropTypes.string,
    bitrate: PropTypes.string,
    sample_rate: PropTypes.string,
    channels: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
  }),
  title: PropTypes.string
};

export default MetadataSection; 