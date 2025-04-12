import { useState, useEffect, useRef } from 'react';
import { Scissors, Play, Pause, Clock, Download, AlertTriangle, Save } from 'lucide-react';

const AudioTrimmer = ({ 
  audioUrl, 
  segments = [], 
  summaryPoints = [],
  onTrimComplete = () => {} 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [trimmedAudioUrl, setTrimmedAudioUrl] = useState(null);
  const [selectedPoints, setSelectedPoints] = useState([]);
  const [trimMode, setTrimMode] = useState('manual'); // 'manual' or 'points'
  
  const audioRef = useRef(null);
  
  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Format time for input fields (more precision)
  const formatTimeInput = (seconds) => {
    return seconds.toFixed(2);
  };
  
  // Parse time from MM:SS format
  const parseTimeInput = (timeStr) => {
    // If it contains a colon, parse as MM:SS
    if (timeStr.includes(':')) {
      const [mins, secs] = timeStr.split(':').map(Number);
      return (mins * 60) + secs;
    }
    // Otherwise parse as raw seconds
    return parseFloat(timeStr);
  };
  
  // Load audio metadata on mount and when URL changes
  useEffect(() => {
    if (!audioUrl) return;
    
    const audio = new Audio(audioUrl);
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      setEndTime(audio.duration);
    });
    
    // Clean up
    return () => {
      audio.removeEventListener('loadedmetadata', () => {});
    };
  }, [audioUrl]);
  
  // Handle audio playback control
  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        audioRef.current.currentTime = startTime;
        if (audioRef.current.currentTime >= endTime) {
          audioRef.current.currentTime = startTime;
        }
        
        // Add listener to pause when reaches end time
        const handleTimeUpdate = () => {
          if (audioRef.current.currentTime >= endTime) {
            audioRef.current.pause();
            setIsPlaying(false);
            audioRef.current.removeEventListener('timeupdate', handleTimeUpdate);
          }
        };
        
        audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
        
        // Use a promise to handle potential play() errors
        audioRef.current.play()
          .then(() => {
            setIsPlaying(true);
          })
          .catch(error => {
            console.error('Error playing audio:', error);
            setError('Unable to play audio. Please check if the audio file is accessible.');
            setIsPlaying(false);
          });
      } catch (error) {
        console.error('Error setting up audio playback:', error);
        setError('Error setting up audio playback. Please try again.');
        setIsPlaying(false);
      }
    }
  };
  
  // Reset form on audio change
  useEffect(() => {
    setStartTime(0);
    setEndTime(duration);
    setSelectedPoints([]);
    setTrimmedAudioUrl(null);
    setSuccess(null);
    setError(null);
  }, [audioUrl, duration]);
  
  // Handle start time change
  const handleStartTimeChange = (e) => {
    const newStartTime = parseTimeInput(e.target.value);
    if (newStartTime < 0) {
      setStartTime(0);
    } else if (newStartTime >= endTime) {
      setStartTime(endTime - 1);
    } else {
      setStartTime(newStartTime);
    }
  };
  
  // Handle end time change
  const handleEndTimeChange = (e) => {
    const newEndTime = parseTimeInput(e.target.value);
    if (newEndTime <= startTime) {
      setEndTime(startTime + 1);
    } else if (newEndTime > duration) {
      setEndTime(duration);
    } else {
      setEndTime(newEndTime);
    }
  };
  
  // Toggle point selection
  const togglePointSelection = (point) => {
    setSelectedPoints((current) => {
      if (current.includes(point)) {
        return current.filter(p => p !== point);
      } else {
        return [...current, point];
      }
    });
  };
  
  // Trim audio function
  const trimAudio = async () => {
    if (!audioUrl) {
      setError("No audio file available to trim");
      return;
    }
    
    if (trimMode === 'manual' && (startTime >= endTime || endTime - startTime < 1)) {
      setError("Please select a valid time range (at least 1 second)");
      return;
    }
    
    if (trimMode === 'points' && selectedPoints.length === 0) {
      setError("Please select at least one summary point");
      return;
    }
    
    setIsTrimming(true);
    setError(null);
    setSuccess(null);
    
    try {
      let endpoint, data;
      
      if (trimMode === 'manual') {
        endpoint = '/api/trim';
        data = {
          file_path: audioUrl,
          start_time: startTime,
          end_time: endTime
        };
      } else {
        endpoint = '/api/trim_by_summary';
        data = {
          file_path: audioUrl,
          summary_points: selectedPoints,
          padding_seconds: 3.0 // Default padding
        };
      }
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }
      
      const responseData = await response.json();
      if (responseData.error) {
        throw new Error(responseData.error);
      }
      
      setTrimmedAudioUrl(responseData.trimmed_file_url);
      setSuccess("Audio trimmed successfully!");
      onTrimComplete(responseData.trimmed_file_url);
    } catch (err) {
      setError(`Failed to trim audio: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
  };
  
  // Ensure points are displayed properly
  useEffect(() => {
    if (Array.isArray(summaryPoints) && summaryPoints.length > 0) {
      // Pre-select first point by default if not already selected
      if (!selectedPoints || selectedPoints.length === 0) {
        setSelectedPoints([summaryPoints[0]]);
      }
    }
  }, [summaryPoints, selectedPoints]);
  
  // Ensure UI displays valid start/end times
  useEffect(() => {
    // Make sure we have valid start/end times to avoid NaN in UI
    if (isNaN(startTime) || startTime < 0) {
      setStartTime(0);
    }
    
    if (isNaN(endTime) || endTime <= 0) {
      if (duration > 0) {
        setEndTime(duration);
      } else {
        setEndTime(60); // Default to 60 seconds if we don't know duration
      }
    }
    
    // If end time is greater than duration, cap it
    if (duration > 0 && endTime > duration) {
      setEndTime(duration);
    }
    
    // If start time is greater than or equal to end time, fix it
    if (startTime >= endTime - 1) {
      setStartTime(Math.max(0, endTime - Math.min(10, endTime))); // At least 1 second difference
    }
  }, [startTime, endTime, duration]);
  
  if (!audioUrl) {
    return null;
  }
  
  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg mt-6">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center">
          <Scissors className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Audio Trimmer</h2>
        </div>
        <div className="text-slate-400">
          {isExpanded ? '▼' : '►'}
        </div>
      </div>
      
      {isExpanded && (
        <div className="mt-4 space-y-4 animate-fadeIn">
          {/* Audio preview */}
          <div className="w-full">
            <audio 
              ref={audioRef} 
              src={audioUrl} 
              className="w-full h-10 mt-2" 
              controls
              onEnded={() => setIsPlaying(false)}
            />
          </div>
          
          {/* Trim Mode Selection */}
          <div className="flex space-x-2 mb-3">
            <button
              className={`px-3 py-2 rounded text-sm ${
                trimMode === 'manual' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
              onClick={() => setTrimMode('manual')}
            >
              Manual Selection
            </button>
            <button
              className={`px-3 py-2 rounded text-sm ${
                trimMode === 'points' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
              onClick={() => setTrimMode('points')}
              disabled={!summaryPoints || summaryPoints.length === 0}
            >
              Based on Key Points
            </button>
          </div>
          
          {/* Manual Trim Controls */}
          {trimMode === 'manual' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="w-full md:w-auto">
                  <label className="block text-sm text-slate-400 mb-1">Start Time</label>
                  <div className="flex items-center">
                    <Clock className="mr-2 text-slate-500" size={16} />
                    <input 
                      type="text" 
                      value={formatTimeInput(startTime)}
                      onChange={handleStartTimeChange}
                      className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-200 w-24"
                    />
                    <span className="ml-2 text-slate-400">sec</span>
                  </div>
                </div>
                
                <div className="w-full md:w-auto">
                  <label className="block text-sm text-slate-400 mb-1">End Time</label>
                  <div className="flex items-center">
                    <Clock className="mr-2 text-slate-500" size={16} />
                    <input 
                      type="text" 
                      value={formatTimeInput(endTime)}
                      onChange={handleEndTimeChange}
                      className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-200 w-24"
                    />
                    <span className="ml-2 text-slate-400">sec</span>
                  </div>
                </div>
                
                <div className="w-full md:w-auto flex items-end">
                  <button
                    className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2 rounded flex items-center"
                    onClick={togglePlayback}
                  >
                    {isPlaying ? (
                      <>
                        <Pause size={16} className="mr-2" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play size={16} className="mr-2" />
                        Preview
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              <div className="text-sm text-slate-400">
                Duration: {formatTime(endTime - startTime)}
              </div>
            </div>
          )}
          
          {/* Summary points selection */}
          {trimMode === 'points' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                Select key points to include in the trimmed audio (with padding):
              </p>
              
              {summaryPoints && summaryPoints.length > 0 ? (
                <div className="space-y-2">
                  {summaryPoints.map((point, index) => (
                    <div 
                      key={`point-${index}`}
                      className={`p-3 rounded cursor-pointer transition-colors ${
                        selectedPoints.includes(point)
                          ? 'bg-blue-900/30 border border-blue-700/50'
                          : 'bg-slate-700/50 border border-slate-600/50 hover:bg-slate-700'
                      }`}
                      onClick={() => togglePointSelection(point)}
                    >
                      <p className="text-sm text-slate-300">{point}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-700/30 rounded border border-slate-600/50">
                  <p className="text-sm text-slate-400">No summary points available. Process the podcast first to generate key points.</p>
                </div>
              )}
              
              <p className="text-sm text-slate-500">
                Selected: {selectedPoints.length} point{selectedPoints.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
          
          {/* Trim Button */}
          <div className="flex justify-end">
            <button
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={trimAudio}
              disabled={isTrimming || 
                (trimMode === 'manual' && (startTime >= endTime)) || 
                (trimMode === 'points' && selectedPoints.length === 0)}
            >
              {isTrimming ? (
                <>
                  <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-opacity-20 border-t-white rounded-full"></div>
                  Trimming...
                </>
              ) : (
                <>
                  <Scissors size={16} className="mr-2" />
                  Trim Audio
                </>
              )}
            </button>
          </div>
          
          {/* Error/Success messages */}
          {error && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-700/50 rounded-md flex items-start">
              <AlertTriangle size={16} className="text-red-400 mr-2 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
          
          {success && (
            <div className="mt-3 p-3 bg-green-900/30 border border-green-700/50 rounded-md text-sm text-green-300">
              {success}
            </div>
          )}
          
          {/* Trimmed Audio Result */}
          {trimmedAudioUrl && (
            <div className="mt-4 p-4 bg-slate-700/50 rounded-lg border border-slate-600/50">
              <h3 className="text-slate-200 font-medium mb-2">Trimmed Audio</h3>
              <audio 
                src={trimmedAudioUrl} 
                className="w-full h-10 mt-2" 
                controls
              />
              <div className="mt-3 flex justify-end">
                <a 
                  href={trimmedAudioUrl} 
                  download="trimmed_podcast.mp3"
                  className="bg-slate-600 hover:bg-slate-500 text-white px-3 py-2 rounded text-sm flex items-center"
                >
                  <Download size={16} className="mr-2" />
                  Download
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AudioTrimmer; 