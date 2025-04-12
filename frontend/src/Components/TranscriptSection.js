"use client";

import { FileText, Download, Users, Hash, Clock, BarChart2, Search, MessageSquare, Copy, X, ChevronDown, ChevronRight, List, AlignJustify } from "lucide-react";
import PropTypes from 'prop-types';
import { useState, useRef, useEffect, useMemo } from 'react';

// Helper function to format time (e.g., 75.5 → 01:15)
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) {
    return "00:00";
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// Helper function to safely process topics
function processTopics(topics) {
  if (!topics || !Array.isArray(topics)) return [];
  
  return topics.map(topic => {
    if (typeof topic === 'string') return topic;
    if (typeof topic === 'object' && topic !== null) {
      return topic.name || topic.label || topic.title || 
             (topic.id ? `Topic ${topic.id}` : null);
    }
    return null;
  }).filter(Boolean); // Remove null/undefined values
}

// Split text into sentences
function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') return [];
  
  // Improved regex to handle various sentence endings and edge cases
  return text
    .replace(/([.?!])\s+(?=[A-Z])/g, "$1|")
    .replace(/([.?!])\s*$/g, "$1|")
    .split("|")
    .filter(sentence => sentence.trim().length > 0);
}

// Segment processor to create sentence-level segments from speaker segments
function processSentenceSegments(segments) {
  if (!segments || !Array.isArray(segments)) return [];
  
  const sentenceSegments = [];
  
  segments.forEach(segment => {
    const sentences = splitIntoSentences(segment.text);
    
    if (sentences.length === 0) return;
    
    // If only one sentence, keep the segment as is
    if (sentences.length === 1) {
      sentenceSegments.push({
        ...segment,
        isPartial: false
      });
      return;
    }
    
    // Calculate approximate duration per sentence
    const segmentDuration = segment.end - segment.start;
    const durationPerSentence = segmentDuration / sentences.length;
    
    // Create a new segment for each sentence
    sentences.forEach((sentence, idx) => {
      const sentenceStart = segment.start + (idx * durationPerSentence);
      const sentenceEnd = sentenceStart + durationPerSentence;
      
      sentenceSegments.push({
        ...segment,
        text: sentence.trim(),
        start: sentenceStart,
        end: sentenceEnd,
        isPartial: true,
        sentenceIndex: idx,
        originalSegmentId: segment.id || `segment-${segment.start}-${segment.end}`
      });
    });
  });
  
  return sentenceSegments;
}

const TranscriptSection = ({ 
  transcript = '',
  segments = [],
  hasSpeakerDetection = false,
  topics = []
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [filteredSpeaker, setFilteredSpeaker] = useState('all');
  const [uniqueSpeakers, setUniqueSpeakers] = useState([]);
  const [viewMode, setViewMode] = useState('sentences'); // 'sentences' or 'segments'
  const transcriptRef = useRef(null);
  
  // Process topics to ensure they're strings
  const processedTopics = processTopics(topics);
  
  // Handle different transcript formats
  const fullText = typeof transcript === 'string' 
    ? transcript 
    : Array.isArray(transcript?.segments) 
      ? transcript.segments.map(s => s.text).join(' ') 
      : '';
    
  const originalSegments = Array.isArray(segments) && segments.length > 0
    ? segments 
    : Array.isArray(transcript?.segments) 
      ? transcript.segments 
      : [];

  // Process segments by sentences
  const sentenceSegments = useMemo(() => {
    return processSentenceSegments(originalSegments);
  }, [originalSegments]);

  // Get the appropriate segments based on view mode
  const processedSegments = useMemo(() => {
    return viewMode === 'sentences' ? sentenceSegments : originalSegments;
  }, [viewMode, sentenceSegments, originalSegments]);

  // Extract unique speakers
  useEffect(() => {
    if (originalSegments.length > 0) {
      const speakers = Array.from(new Set(
        originalSegments
          .map(segment => segment.speaker)
          .filter(Boolean)
      ));
      setUniqueSpeakers(speakers);
    }
  }, [originalSegments]);

  // Toggle between sentence view and segment view
  const toggleViewMode = () => {
    setViewMode(prevMode => prevMode === 'sentences' ? 'segments' : 'sentences');
  };
  
  // Search functionality
  const handleSearch = (e) => {
    setSearchQuery(e.target.value);
    
    // No need to manipulate DOM directly for search highlights - React can handle this
    // with proper state-based rendering in the filtered segments below
  };
  
  // Apply search highlighting to text
  const highlightSearchMatches = (text) => {
    if (!searchQuery || !text) return text;
    
    // Split the text on the search term to highlight it
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    
    return parts.map((part, i) => 
      part.toLowerCase() === searchQuery.toLowerCase() 
        ? <mark key={i} className="bg-yellow-600/30 text-white">{part}</mark> 
        : part
    );
  };
  
  // Refs for search result segments
  const searchMatchRefs = useRef({});
  
  // Scroll to first match when search query changes
  useEffect(() => {
    if (searchQuery) {
      // Use a small timeout to ensure DOM has updated
      setTimeout(() => {
        // Find first matching segment
        const firstMatchIndex = processedSegments.findIndex(segment => 
          segment.text.toLowerCase().includes(searchQuery.toLowerCase())
        );
        
        if (firstMatchIndex >= 0 && searchMatchRefs.current[firstMatchIndex]) {
          searchMatchRefs.current[firstMatchIndex].scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }
      }, 100);
    }
  }, [searchQuery, processedSegments, filteredSpeaker]);
  
  // Handle speaker filter
  const handleSpeakerFilter = (e) => {
    setFilteredSpeaker(e.target.value);
  };
  
  // Copy to clipboard
  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };
  
  // Download transcript
  const downloadTranscript = () => {
    const element = document.createElement("a");
    const file = new Blob([fullText], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = "transcript.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };
  
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
  
  // Get speaker name display
  function formatSpeakerName(speakerId) {
    if (!speakerId) return "Unknown Speaker";
    
    if (speakerId.startsWith('SPEAKER_')) {
      return `Speaker ${speakerId.replace('SPEAKER_', '')}`;
    }
    
    return speakerId;
  }
  
  if (!fullText) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
        <div className="flex items-center mb-4">
          <FileText className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Transcript</h2>
        </div>
        <div className="text-slate-400 text-sm p-3 bg-slate-800/70 rounded-lg border border-slate-700/50">
          No transcript available. Please process a podcast to see a transcript.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center">
          <FileText className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Transcript</h2>
          <div className="ml-3 text-xs py-0.5 px-2 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/10">
            {processedSegments.length} {viewMode === 'sentences' ? 'sentences' : 'segments'}
          </div>
        </div>
        <div className="text-slate-400">
          {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </div>
      
      <div className={`mt-4 ${isExpanded ? '' : 'max-h-96 overflow-hidden mask-bottom'}`}>
        {/* Search bar and tools */}
        <div className="flex flex-wrap items-center mb-4 gap-2">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search transcript..."
              className="bg-slate-700/50 border border-slate-600/50 rounded-lg pl-10 pr-4 py-2 w-full text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              value={searchQuery}
              onChange={handleSearch}
            />
            {searchQuery && (
              <button 
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-300"
                onClick={() => setSearchQuery('')}
              >
                <X size={16} />
              </button>
            )}
          </div>
          
          <button
            className="bg-slate-700/70 hover:bg-slate-700 border border-slate-600/50 rounded-lg px-3 py-2 text-slate-300 flex items-center transition-colors"
            onClick={copyToClipboard}
          >
            <Copy size={16} className="mr-2" />
            {isCopied ? 'Copied!' : 'Copy'}
          </button>
          
          <button
            className="bg-slate-700/70 hover:bg-slate-700 border border-slate-600/50 rounded-lg px-3 py-2 text-slate-300 flex items-center transition-colors"
            onClick={downloadTranscript}
          >
            <Download size={16} className="mr-2" />
            Download
          </button>
        </div>
        
        {/* Topics Section */}
        {processedTopics && processedTopics.length > 0 && (
          <div className="content-container mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Hash size={14} className="text-slate-400" />
              <h4 className="font-medium text-slate-300 text-sm">Topics</h4>
              <div className="text-xs py-0.5 px-2 rounded-full bg-slate-700/60 text-slate-300">
                {processedTopics.length} detected
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2.5 bg-slate-800/40 p-4 rounded-md border border-slate-700/20">
              {processedTopics.map((topic, index) => (
                <div 
                  key={index}
                  className="bg-slate-800/70 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700/60 flex items-center transition-all duration-200 hover:bg-slate-800/90"
                >
                  <Hash size={10} className="mr-1.5 text-slate-400" />
                  {topic}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Segments Section */}
        <div className="content-container mt-6">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <BarChart2 size={14} className="text-slate-400" />
              <h4 className="font-medium text-slate-300 text-sm">Transcript</h4>
              <div className="text-xs py-0.5 px-2 rounded-full bg-slate-700/60 text-slate-300">
                {processedSegments?.length || 0} {viewMode === 'sentences' ? 'sentences' : 'segments'}
              </div>
            </div>
            
            <div className="flex items-center gap-3 mt-2 sm:mt-0">
              {/* View Mode Toggle */}
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">View:</span>
                <button 
                  onClick={toggleViewMode}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    viewMode === 'sentences' 
                      ? 'bg-blue-600/20 text-blue-300 border-blue-600/30' 
                      : 'bg-slate-800/70 text-slate-400 border-slate-700/60 hover:bg-slate-700/50 hover:text-slate-300'
                  }`}
                >
                  <AlignJustify size={12} />
                  <span>Sentences</span>
                </button>
                <button 
                  onClick={toggleViewMode}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    viewMode === 'segments' 
                      ? 'bg-blue-600/20 text-blue-300 border-blue-600/30' 
                      : 'bg-slate-800/70 text-slate-400 border-slate-700/60 hover:bg-slate-700/50 hover:text-slate-300'
                  }`}
                >
                  <Users size={12} />
                  <span>Speakers</span>
                </button>
              </div>
              
              {/* Speaker filter */}
              {hasSpeakerDetection && uniqueSpeakers.length > 0 && (
                <div className="flex items-center space-x-3">
                  <span className="text-xs text-slate-400">Filter by speaker:</span>
                  <select
                    className="bg-slate-800/70 text-slate-300 text-xs rounded-md border border-slate-700/60 py-1.5 px-2.5 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-all"
                    value={filteredSpeaker}
                    onChange={handleSpeakerFilter}
                  >
                    <option value="all">All speakers</option>
                    {uniqueSpeakers.map(speaker => (
                      <option key={speaker} value={speaker}>
                        {formatSpeakerName(speaker)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-slate-800/40 p-4 rounded-md border border-slate-700/20">
            <div className="space-y-3.5 max-h-[450px] overflow-y-auto pr-3 custom-scrollbar" ref={transcriptRef}>
              {processedSegments
                .filter(segment => {
                  // Apply text search filter
                  const matchesSearch = segment.text.toLowerCase().includes(searchQuery.toLowerCase());
                  
                  // Apply speaker filter
                  const matchesSpeaker = filteredSpeaker === 'all' || segment.speaker === filteredSpeaker;
                  
                  return matchesSearch && matchesSpeaker;
                })
                .map((segment, index) => {
                  // Process segment topics to ensure they're strings
                  const segmentTopics = segment.topics 
                    ? processTopics(segment.topics) 
                    : [];
                  
                  // Get speaker color
                  const speakerColor = segment.speaker ? getSpeakerColor(segment.speaker) : '#9E9E9E';
                  
                  // Determine if we should show speaker for this sentence
                  // For sentence view, only show speaker badge if it's the first sentence of a speaker's segment
                  const showSpeaker = hasSpeakerDetection && segment.speaker && 
                    (viewMode === 'segments' || !segment.isPartial || segment.sentenceIndex === 0);
                  
                  return (
                    <div 
                      key={`${index}-${segment.start}-${segment.end}`}
                      className={`bg-slate-800/70 p-4 rounded-md border border-slate-700/60 hover:border-slate-600/80 transition-all ${
                        viewMode === 'sentences' && segment.isPartial 
                          ? 'border-opacity-40' 
                          : ''
                      }`}
                      style={{ 
                        borderLeftColor: showSpeaker ? speakerColor : undefined, 
                        borderLeftWidth: showSpeaker ? '3px' : undefined
                      }}
                      ref={(el) => {
                        searchMatchRefs.current[index] = el;
                      }}
                    >
                      <div className="flex flex-col space-y-3">
                        <div className="flex flex-wrap justify-between items-start gap-2">
                          {showSpeaker && (
                            <div className="text-slate-200 text-xs flex items-center px-2.5 py-1 rounded-full"
                              style={{ 
                                backgroundColor: `${speakerColor}20`, 
                                borderColor: `${speakerColor}40`,
                                color: speakerColor,
                                border: '1px solid'
                              }}
                            >
                              <Users size={10} className="mr-1.5" style={{ color: speakerColor }} />
                              {formatSpeakerName(segment.speaker)}
                            </div>
                          )}
                          
                          <div className="text-slate-400 text-xs whitespace-nowrap flex items-center bg-slate-700/60 py-1 px-2.5 rounded-full ml-auto">
                            <Clock size={10} className="mr-1.5 text-slate-500" />
                            {formatTime(segment.start)} - {formatTime(segment.end)}
                          </div>
                        </div>
                        
                        <p className={`text-slate-200 text-sm leading-relaxed bg-slate-700/30 p-3.5 rounded-md ${
                          viewMode === 'sentences' && segment.isPartial ? 'border-l-2' : ''
                        }`}
                        style={{
                          borderLeftColor: viewMode === 'sentences' && segment.isPartial ? speakerColor : undefined 
                        }}
                        >
                          {highlightSearchMatches(segment.text)}
                        </p>
                        
                        {segmentTopics && segmentTopics.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2">
                            {segmentTopics.map((topic, idx) => (
                              <div key={`topic-${idx}`} className="text-xs text-slate-300 flex items-center bg-slate-700/60 py-1 px-2.5 rounded-full">
                                <Hash size={10} className="mr-1.5 text-slate-400" />
                                {topic}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

TranscriptSection.propTypes = {
  transcript: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  segments: PropTypes.array,
  hasSpeakerDetection: PropTypes.bool,
  topics: PropTypes.array
};

export default TranscriptSection; 