"use client";

import React, { useMemo, useState } from "react";
import { Users, BarChart2, PieChart, User, ChevronDown, ChevronRight, Activity, Clock, Percent, MessageSquare } from "lucide-react";
import PropTypes from 'prop-types';

export default function SpeakerDetails({ diarization = {} }) {
  const [expanded, setExpanded] = useState(false);
  
  // Extract segments from diarization if available, otherwise use empty array
  const segments = useMemo(() => {
    if (diarization && Array.isArray(diarization.segments)) {
      return diarization.segments;
    }
    return [];
  }, [diarization]);
  
  // Check if we have speaker detection
  const hasSpeakerDetection = useMemo(() => {
    return !!(diarization && Array.isArray(diarization.speakers) && diarization.speakers.length > 0);
  }, [diarization]);
  
  // Extract speaker waveform if available
  const speakerWaveform = diarization?.waveform || null;
  
  // Calculate speaker statistics
  const speakerStats = useMemo(() => {
    // Return empty stats if no speaker detection or no segments
    if (!hasSpeakerDetection || !segments || segments.length === 0) {
      return { speakers: [], totalDuration: 0 };
    }
    
    const stats = {};
    let totalDuration = 0;
    
    // Process each segment to extract speaker stats
    segments.forEach(segment => {
      if (!segment.speaker) return;
      
      const speaker = segment.speaker;
      const duration = segment.end - segment.start;
      totalDuration += duration;
      
      if (!stats[speaker]) {
        stats[speaker] = {
          id: speaker,
          name: formatSpeakerName(speaker),
          duration: 0,
          wordCount: 0,
          segmentCount: 0,
          color: getSpeakerColor(speaker)
        };
      }
      
      stats[speaker].duration += duration;
      stats[speaker].wordCount += segment.text.split(/\s+/).filter(Boolean).length;
      stats[speaker].segmentCount += 1;
    });
    
    // Convert to array and calculate percentages
    const speakersArray = Object.values(stats).map(speaker => ({
      ...speaker,
      percentage: (speaker.duration / totalDuration) * 100
    }));
    
    // Sort by talk time (descending)
    return {
      speakers: speakersArray.sort((a, b) => b.duration - a.duration),
      totalDuration
    };
  }, [segments, hasSpeakerDetection]);

  // If no speaker detection or no segments, don't render
  if (!hasSpeakerDetection || speakerStats.speakers.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
        <div className="flex items-center mb-4">
          <Users className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Speaker Analysis</h2>
        </div>
        <div className="text-slate-400 text-sm p-3 bg-slate-800/70 rounded-lg border border-slate-700/50">
          No speaker data available. This can happen with short audio clips or when speaker detection is disabled.
        </div>
      </div>
    );
  }

  // Format time (seconds to MM:SS)
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Format speaker name
  function formatSpeakerName(speakerId) {
    if (!speakerId) return "Unknown Speaker";
    
    if (speakerId.startsWith('SPEAKER_')) {
      return `Speaker ${speakerId.replace('SPEAKER_', '')}`;
    }
    
    return speakerId;
  }

  // Get speaker color 
  function getSpeakerColor(speakerId) {
    // Default colors for up to 12 speakers
    const colors = [
      '#4285F4', '#EA4335', '#FBBC05', '#34A853', 
      '#FF6D01', '#46BDC6', '#9900FF', '#795548',
      '#9E9E9E', '#607D8B', '#1DE9B6', '#6200EA'
    ];
    
    if (!speakerId) return colors[0];
    
    // Extract speaker number if speakerId is in format SPEAKER_X
    let speakerNum = 0;
    if (typeof speakerId === 'string' && speakerId.startsWith('SPEAKER_')) {
      const num = parseInt(speakerId.replace('SPEAKER_', ''), 10);
      if (!isNaN(num)) {
        speakerNum = num - 1; // zero-based index
      }
    } else if (typeof speakerId === 'string') {
      // If it's just a string like "A", "B", etc.
      speakerNum = speakerId.charCodeAt(0) - 65; // A=0, B=1, etc.
    }
    
    // Ensure we have a valid index - handles negative values and overflows
    speakerNum = Math.abs(speakerNum % colors.length);
    return colors[speakerNum];
  }

  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center">
          <Users className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Speaker Analysis</h2>
        </div>
        <div className="text-slate-400">
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </div>
      
      {/* Speaker waveform visualization */}
      {speakerWaveform && (
        <div className="mt-4 rounded-lg overflow-hidden bg-slate-900/50 border border-slate-700/50">
          <img 
            src={`data:image/png;base64,${speakerWaveform}`} 
            alt="Speaker Timeline" 
            className="w-full h-auto"
          />
        </div>
      )}
      
      {/* Speaker overview */}
      <div className="mt-4 bg-slate-800/70 rounded-lg p-3">
        <div className="text-sm text-slate-300 mb-2 flex items-center">
          <Activity size={16} className="mr-2 text-slate-400" />
          <span className="mr-1">{speakerStats.speakers.length}</span> 
          speakers detected • 
          <Clock size={14} className="mx-2 text-slate-400" />
          <span>{formatTime(speakerStats.totalDuration)} total</span>
        </div>
        
        {/* Speaking time distribution */}
        <div className="h-4 w-full bg-slate-700/50 rounded-full overflow-hidden flex">
          {speakerStats.speakers.map((speaker, index) => (
            <div 
              key={`bar-${index}`}
              className="h-full transition-all duration-300"
              style={{ 
                width: `${speaker.percentage}%`, 
                backgroundColor: speaker.color,
                minWidth: speaker.percentage > 0 ? '3px' : '0'
              }}
              title={`${speaker.name}: ${speaker.percentage.toFixed(1)}%`}
            />
          ))}
        </div>
      </div>
      
      {/* Detailed speaker list (expandable) */}
      <div className={`mt-4 space-y-3 ${expanded ? 'animate-fadeIn' : 'hidden'}`}>
        {speakerStats.speakers.map((speaker, index) => (
          <div 
            key={`speaker-${index}`}
            className="bg-slate-800/70 rounded-lg p-3 border border-slate-700/30 hover:border-slate-600/60 transition-colors"
            style={{ borderLeftColor: speaker.color, borderLeftWidth: '3px' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div 
                  className="w-4 h-4 rounded-full mr-3" 
                  style={{ backgroundColor: speaker.color }}
                />
                <span className="font-medium text-slate-200">{speaker.name}</span>
              </div>
              <div className="flex items-center space-x-4 text-xs">
                <div className="flex items-center text-slate-400">
                  <Clock size={14} className="mr-1 text-slate-500" />
                  {formatTime(speaker.duration)}
                </div>
                <div className="flex items-center text-slate-400">
                  <Percent size={14} className="mr-1 text-slate-500" />
                  {Math.round(speaker.percentage)}%
                </div>
                <div className="flex items-center text-slate-400">
                  <MessageSquare size={14} className="mr-1 text-slate-500" />
                  {speaker.wordCount} words
                </div>
              </div>
            </div>
            
            {/* Speaker stats in more detail */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="bg-slate-700/30 rounded p-2 text-center">
                <div className="text-xs text-slate-400">Talk Time</div>
                <div className="text-sm font-medium text-slate-300">{formatTime(speaker.duration)}</div>
              </div>
              <div className="bg-slate-700/30 rounded p-2 text-center">
                <div className="text-xs text-slate-400">Segments</div>
                <div className="text-sm font-medium text-slate-300">{speaker.segmentCount}</div>
              </div>
              <div className="bg-slate-700/30 rounded p-2 text-center">
                <div className="text-xs text-slate-400">Words/Min</div>
                <div className="text-sm font-medium text-slate-300">
                  {Math.round(speaker.wordCount / (speaker.duration / 60)) || 0}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Show more/less button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full mt-4 py-2 text-sm text-center text-slate-400 hover:text-slate-300 transition-colors rounded-md bg-slate-800/70 border border-slate-700/40 hover:bg-slate-800/90"
      >
        {expanded ? 'Show less details' : 'Show speaker details'}
      </button>
    </div>
  );
}

SpeakerDetails.propTypes = {
  diarization: PropTypes.shape({
    segments: PropTypes.array,
    speakers: PropTypes.array,
    waveform: PropTypes.string
  })
}; 