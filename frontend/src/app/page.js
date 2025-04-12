"use client";
import { useState, useRef, useCallback, lazy, Suspense, useEffect } from "react";
import { UploadCloud, Youtube, Loader2, FileAudio, Info, ChevronRight, ChevronDown, AlertTriangle, Clock, X } from "lucide-react";
import { useProcessing } from "@/hooks/useProcessing";
import { Podcast } from "lucide-react";

// Dynamically import components
const MetadataSection = lazy(() => import("@/Components/MetadataSection"));
const SpeakerDetails = lazy(() => import("@/Components/SpeakerDetails"));
const TranscriptSection = lazy(() => import("@/Components/TranscriptSection"));
const AbstractiveSummary = lazy(() => import("@/Components/AbstractiveSummary"));
const ExtractiveSummary = lazy(() => import("@/Components/ExtractiveSummary"));
const TopicDetection = lazy(() => import("@/Components/TopicDetection"));
const AudioTrimmer = lazy(() => import("@/Components/AudioTrimmer"));

// Loading fallback component
const ComponentLoader = () => (
  <div className="animate-pulse bg-slate-800/60 rounded-xl p-6 w-full h-32">
    <div className="flex items-center">
      <div className="h-8 w-8 bg-slate-700/80 rounded-md mr-3"></div>
      <div className="h-6 bg-slate-700/80 rounded w-1/3"></div>
    </div>
    <div className="mt-4 space-y-3">
      <div className="h-4 bg-slate-700/60 rounded w-full"></div>
      <div className="h-4 bg-slate-700/60 rounded w-5/6"></div>
      <div className="h-4 bg-slate-700/60 rounded w-4/6"></div>
    </div>
  </div>
);

// YouTube URL validation regex
const YOUTUBE_URL_PATTERN = /^(https?:\/\/)?(www\.)?(youtube|youtu|youtube-nocookie)\.(com|be)\/(?:watch\?v=|shorts\/|embed\/|v\/|.+\?v=)?([a-zA-Z0-9_-]{11})(?:[&?].*)?$/;

// Function to validate YouTube URL
const isValidYouTubeURL = (url) => {
  if (!url || typeof url !== 'string') return false;
  return YOUTUBE_URL_PATTERN.test(url.trim());
};

// Function to format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
};

// Function to process segments and extract sentences
const processSegmentsWithSentences = (segments) => {
  if (!segments || !Array.isArray(segments)) return [];
  
  const processedSegments = [];
  
  segments.forEach(segment => {
    if (!segment.text) return;
    
    processedSegments.push({
      ...segment,
      // We mark each segment to indicate it's from the original segments,
      // not generated in the frontend (sentences will be created in the component)
      isOriginalSegment: true
    });
  });
  
  return processedSegments;
};

export default function PodcastSummarizer() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [youtubeURL, setYoutubeURL] = useState("");
  const [activeTab, setActiveTab] = useState("upload");
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const fileInputRef = useRef(null);

  const {
    processing,
    progress,
    result,
    error,
    isLoadingResult,
    handleProcessing,
    setError,
    jobId
  } = useProcessing();

  // Reset states on fresh render
  useEffect(() => {
    setSelectedFile(null);
    setYoutubeURL("");
  }, []);

  // Handle file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Reset state when switching tabs
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setError(null);
    setSelectedFile(null);
    setYoutubeURL("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [setError]);

  const handleFileUpload = useCallback(async () => {
    if (!selectedFile) {
      setError("⚠ Please select a file to upload.");
      return;
    }

    // Validate file type
    const validTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 
                        'video/mp4', 'video/webm', 'video/ogg'];
    if (!validTypes.includes(selectedFile.type)) {
      setError("⚠ Invalid file type. Please upload an audio or video file.");
      return;
    }

    // Check file size (limit to 45MB to stay safely under 50MB limit)
    const MAX_FILE_SIZE = 45 * 1024 * 1024; // 45MB

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(`⚠ File size exceeds the limit (45MB). Please upload a smaller file. Current size: ${formatFileSize(selectedFile.size)}`);
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    
    try {
      await handleProcessing("upload", formData, { "Content-Type": "multipart/form-data" });
    } catch (err) {
      // Additional error handling if needed
      if (err.message?.includes("timeout") || err.message?.includes("cancelled")) {
        setError("⚠ Request was cancelled - processing took too long. Try with a shorter audio file.");
      } else if (err.message?.includes("size") || err.message?.includes("large")) {
        setError(`⚠ File is too large (${formatFileSize(selectedFile.size)}). Please try a smaller file or compress it.`);
      }
    }
  }, [selectedFile, handleProcessing, setError]);

  const processYouTube = useCallback(async () => {
    if (!youtubeURL.trim()) {
      setError("⚠ Enter a valid YouTube URL.");
      return;
    }

    if (!isValidYouTubeURL(youtubeURL)) {
      setError("⚠ Invalid YouTube URL. Please provide a valid link.");
      return;
    }

    const formData = new FormData();
    formData.append("url", youtubeURL.trim());
    
    try {
      await handleProcessing("youtube", formData, { "Content-Type": "multipart/form-data" });
    } catch (err) {
      // Handle specific YouTube errors
      if (err.message?.includes("Copyright") || err.message?.includes("copyright")) {
        setError("⚠ This video has copyright restrictions and cannot be processed.");
      } else if (err.message?.includes("unavailable") || err.message?.includes("private")) {
        setError("⚠ This video is private or unavailable. Please try another video.");
      } else if (err.message?.includes("timeout") || err.message?.includes("cancelled")) {
        setError("⚠ Processing took too long and was cancelled. Try a shorter video or specify timestamps in URL.");
      }
    }
  }, [youtubeURL, handleProcessing, setError]);

  // Handle rendering of results
  const renderResults = () => {
    // Check if we only have a job ID but no actual results yet
    if (!result || (typeof result === 'object' && result.job_id && !result.metadata && !result.transcript && !result.summary)) {
      return (
        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700/40 shadow-lg">
          <h3 className="text-lg font-medium text-slate-200 mb-4">Processing Your Content</h3>
          <p className="text-slate-300 mb-4">
            Your podcast is currently being processed. This may take a few minutes depending on the length of the content.
          </p>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Clock className="animate-pulse" size={16} />
            <span>Job ID: {jobId || (result && result.job_id)}</span>
          </div>
        </div>
      );
    }
    
    // Check if result has the expected structure
    const hasValidStructure = result && 
      (result?.metadata || result?.transcript || result?.abstractive_summary || result?.extractive_summary);
    
    if (!hasValidStructure && !isLoadingResult) {
      return (
        <div className="mt-4 p-3 rounded-md text-sm border border-red-500/20 bg-red-500/10 animate-fadeIn">
          <p className="text-red-300">Invalid response format</p>
        </div>
      );
    }
    
    // Get audio URL if available
    const audioUrl = result?.metadata?.audio_url 
      ? `${process.env.NEXT_PUBLIC_API_URL || ''}${result.metadata.audio_url}`
      : null;
      
    // Get extractive summary points for trimming
    const extractiveSummaryPoints = result?.extractive_summary || [];

    // Process topics to ensure they can be safely rendered
    const processTopics = (topicsArray) => {
      if (!topicsArray || !Array.isArray(topicsArray)) return [];
      
      return topicsArray.map(topic => {
        // If it's already a string, return it
        if (typeof topic === 'string') return topic;
        
        // If it's an object, extract the name or other identifiers
        if (typeof topic === 'object' && topic !== null) {
          return {
            name: topic.name || topic.label || topic.title || 
                 (topic.id ? `Topic ${topic.id}` : 'Unnamed Topic'),
            keywords: Array.isArray(topic.keywords) 
              ? topic.keywords 
              : Array.isArray(topic.improved_keywords)
                ? topic.improved_keywords
                : [],
            mentions: topic.mentions || 
                   (topic.sample_text ? [topic.sample_text] : []),
            score: typeof topic.score === 'number' ? topic.score : null,
            description: typeof topic.description === 'string' ? topic.description : null
          };
        }
        
        // Default fallback
        return { name: 'Unknown Topic' };
      });
    };
    
    // Process topics from the result
    const processedTopics = processTopics(result?.topics || []);
    
    return (
      <div className="space-y-6">
        {/* Metadata Section - Now Full Width and Centered at Top */}
        {result?.metadata && (
          <div className="w-full animate-fadeIn">
            <Suspense fallback={<ComponentLoader />}>
              <MetadataSection metadata={result.metadata} />
            </Suspense>
          </div>
        )}
        
        {/* Two Column Layout for Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - 8/12 */}
          <div className="lg:col-span-8 space-y-6">
            {/* Speaker Details Section */}
            {result?.diarization?.speakers && (
              <div className="animate-fadeIn animate-delay-100">
                <Suspense fallback={<ComponentLoader />}>
                  <SpeakerDetails diarization={result.diarization} />
                </Suspense>
              </div>
            )}
            
            {/* Transcript Section */}
            {(result?.transcript || result?.segments) && (
              <div className="animate-fadeIn animate-delay-200">
                <Suspense fallback={<ComponentLoader />}>
                  <TranscriptSection 
                    transcript={result.transcript || ''}
                    segments={processSegmentsWithSentences(result.segments || [])}
                    hasSpeakerDetection={!!result.diarization?.speakers?.length}
                    topics={processedTopics.map(t => t.name)}
                  />
                </Suspense>
              </div>
            )}
          </div>
          
          {/* Right Column - 4/12 */}
          <div className="lg:col-span-4 space-y-6">
            {/* Abstractive Summary */}
            {result?.abstractive_summary && (
              <div className="animate-fadeIn animate-delay-300">
                <Suspense fallback={<ComponentLoader />}>
                  <AbstractiveSummary summary={result.abstractive_summary} />
                </Suspense>
              </div>
            )}
            
            {/* Extractive Summary */}
            {result?.extractive_summary && (
              <div className="animate-fadeIn animate-delay-400">
                <Suspense fallback={<ComponentLoader />}>
                  <ExtractiveSummary summary={result.extractive_summary} />
                </Suspense>
              </div>
            )}
            
            {/* Topic Detection */}
            {result?.topics && (
              <div className="animate-fadeIn animate-delay-500">
                <Suspense fallback={<ComponentLoader />}>
                  <TopicDetection 
                    topics={processedTopics} 
                  />
                </Suspense>
              </div>
            )}
            
            {/* Audio Trimmer */}
            {audioUrl && (
              <div className="animate-fadeIn animate-delay-600">
                <Suspense fallback={<ComponentLoader />}>
                  <AudioTrimmer 
                    audioUrl={audioUrl}
                    segments={result.segments}
                    summaryPoints={extractiveSummaryPoints}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A1122] bg-gradient-to-b from-slate-900 to-slate-800">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/50 fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Podcast size={20} className="text-white" />
              </div>
              <h1 className="text-xl font-semibold text-slate-200">Podcast Summarizer</h1>
            </div>
            <div className="flex items-center space-x-4">
              <a
                href="#videos"
                className="text-slate-400 hover:text-slate-300 transition-colors flex items-center"
              >
                <FileAudio size={16} className="mr-1.5" />
                <span className="text-sm">Videos</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Sidebar - Content Source */}
          <div className="lg:col-span-3">
            <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg sticky top-24">
              <div className="flex items-center mb-4">
                <FileAudio className="mr-3 text-blue-400" size={18} />
                <h2 className="text-lg font-medium text-slate-200">Content Source</h2>
              </div>
              
              {/* Tab Navigation */}
              <div className="flex gap-2 p-1 bg-slate-900/50 rounded-lg border border-slate-700/40 mb-5">
                <button 
                  onClick={() => handleTabChange('upload')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md transition-all ${
                    activeTab === 'upload' 
                      ? 'bg-slate-800 text-slate-200 shadow-sm' 
                      : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/40'
                  }`}
                >
                  <UploadCloud size={16} />
                  <span className="font-medium">Upload</span>
                </button>
                <button 
                  onClick={() => handleTabChange('youtube')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md transition-all ${
                    activeTab === 'youtube' 
                      ? 'bg-slate-800 text-slate-200 shadow-sm' 
                      : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/40'
                  }`}
                >
                  <Youtube size={16} />
                  <span className="font-medium">YouTube</span>
                </button>
              </div>
              
              {/* Upload Section */}
              {activeTab === 'upload' && (
                <div className="space-y-4">
                  <div className="relative">
                    <label
                      className={`group flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer overflow-hidden 
                        transition-colors duration-200 
                        ${selectedFile 
                          ? "border-blue-500/50 bg-blue-500/5" 
                          : "border-slate-600 hover:border-slate-500 hover:bg-slate-700/20 bg-slate-800/50"}`}
                    >
                      {selectedFile ? (
                        <div className="flex flex-col items-center justify-center pt-5 pb-6 px-2 text-center">
                          <FileAudio size={24} className="mb-3 text-blue-500" />
                          <p className="mb-1 text-sm text-slate-300 font-medium truncate max-w-full">
                            {selectedFile.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatFileSize(selectedFile.size)}
                          </p>
                          <p className="text-xs text-blue-500/80 mt-1.5">
                            Click to change file
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <UploadCloud 
                            size={24} 
                            className="mb-3 text-slate-400 group-hover:text-slate-300 transition-colors duration-200" 
                          />
                          <p className="mb-2 text-sm text-slate-400 group-hover:text-slate-300 transition-colors duration-200">
                            <span className="font-medium">Click to upload</span>{" "}
                            or drag and drop
                          </p>
                          <p className="text-xs text-slate-500">
                            Audio or Video files (max 45MB)
                          </p>
                        </div>
                      )}
                      <input
                        id="dropzone-file"
                        type="file"
                        className="hidden"
                        onChange={handleFileChange}
                        ref={fileInputRef}
                        accept="audio/*,video/*"
                      />
                    </label>
                  </div>
                  
                  <button
                    onClick={handleFileUpload}
                    disabled={!selectedFile || processing}
                    className={`w-full py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all duration-200
                      ${!selectedFile || processing
                        ? "bg-slate-800/80 text-slate-500 cursor-not-allowed" 
                        : "bg-blue-600 text-slate-200 hover:bg-blue-700"
                      }`}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <FileAudio size={16} />
                        <span>Process Audio</span>
                      </>
                    )}
                  </button>
                </div>
              )}
              
              {/* YouTube Section */}
              {activeTab === 'youtube' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-md border focus-within:border-slate-500 transition-all duration-200 bg-slate-800/60 border-slate-600/80">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <Youtube size={16} className="text-slate-400" />
                      </div>
                      <input 
                        type="text"
                        placeholder="Enter YouTube URL"
                        value={youtubeURL}
                        onChange={(e) => setYoutubeURL(e.target.value)}
                        className={`w-full py-2.5 pl-10 pr-4 rounded-md outline-none transition-all focus:ring-1 focus:ring-slate-400 text-sm bg-slate-700/70 text-slate-200 border ${
                          youtubeURL.trim() && !isValidYouTubeURL(youtubeURL) 
                            ? "border-red-400/50" 
                            : isValidYouTubeURL(youtubeURL) 
                              ? "border-blue-500/50" 
                              : "border-transparent"
                        }`}
                      />
                      {youtubeURL.trim() && (
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                          {isValidYouTubeURL(youtubeURL) ? (
                            <div className="text-green-400 text-base">✓</div>
                          ) : (
                            <div className="text-red-400 text-base">✗</div>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {youtubeURL.trim() && !isValidYouTubeURL(youtubeURL) && (
                      <p className="text-xs mt-2 ml-1 text-red-400">
                        Invalid YouTube URL format.
                      </p>
                    )}
                    
                    <div className="mt-2 text-center">
                      <p className="text-xs text-slate-500">
                        Example: https://www.youtube.com/watch?v=...
                      </p>
                    </div>
                  </div>
                  
                  <button 
                    onClick={processYouTube}
                    disabled={!isValidYouTubeURL(youtubeURL) || processing}
                    className={`w-full py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all duration-200
                      ${!isValidYouTubeURL(youtubeURL) || processing 
                        ? "bg-slate-800/80 text-slate-500 cursor-not-allowed" 
                        : "bg-blue-600 text-slate-200 hover:bg-blue-700"
                      }`}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <Youtube size={16} />
                        <span>Process YouTube</span>
                      </>
                    )}
                  </button>
                </div>
              )}
              
              {/* Error Display */}
              {error && (
                <div className={`mt-5 p-3 rounded-md text-sm border animate-fadeIn ${
                  error.includes("timeout") || error.includes("cancelled") 
                    ? "border-amber-500/20 bg-amber-500/10" 
                    : "border-red-500/20 bg-red-500/10"
                }`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`w-4 h-4 ${
                      error.includes("timeout") || error.includes("cancelled")
                        ? "text-amber-400"
                        : "text-red-400"
                    } mt-0.5 flex-shrink-0`} />
                    <p className={
                      error.includes("timeout") || error.includes("cancelled")
                        ? "text-amber-300"
                        : "text-red-300"
                    }>{error.replace('⚠ ', '')}</p>
                  </div>
                </div>
              )}
              
              {/* Processing Status */}
              {processing && (
                <div className="mt-5 animate-fadeIn">
                  <div className="flex justify-between text-xs mb-2">
                    <span className="flex items-center text-slate-300">
                      <Loader2 className="animate-spin mr-1.5" size={12} />
                      {progress < 20 ? "Initializing" : progress < 70 ? "Processing" : progress < 100 ? "Analyzing" : "Complete"}
                    </span>
                    <span className="font-medium text-slate-300">{progress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden bg-slate-800/70">
                    <div 
                      style={{ width: `${progress}%` }}
                      className="h-full bg-blue-500 transition-all duration-300"
                    />
                  </div>
                </div>
              )}
              
              {/* How it works section */}
              <div className="mt-6">
                <button 
                  onClick={() => setIsHowItWorksOpen(!isHowItWorksOpen)}
                  className="w-full flex items-center justify-between gap-2.5 p-3 bg-slate-800/60 rounded-md text-left focus:outline-none collapse-toggle border border-slate-700/30 hover:bg-slate-800/80 transition-colors"
                  aria-expanded={isHowItWorksOpen}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-md bg-slate-700/80">
                      <Info size={14} className="text-slate-300" />
                    </div>
                    <h3 className="text-slate-200">How it works</h3>
                  </div>
                  <div className={`collapsible-arrow ${isHowItWorksOpen ? 'open' : ''}`}>
                    <ChevronDown size={16} className="text-slate-400" />
                  </div>
                </button>
                
                <div 
                  className={`collapsible-content ${isHowItWorksOpen ? 'open' : 'closed'}`}
                >
                  <ol className="text-sm space-y-3 mt-3 ml-1 text-slate-300 pt-2 bg-slate-800/40 p-4 rounded-md border border-slate-700/20">
                    <li className="flex items-start gap-2.5">
                      <div className="flex items-center justify-center p-1 rounded-full bg-slate-700/50 mt-0.5">
                        <ChevronRight size={11} className="text-slate-400" />
                      </div>
                      <p>Upload an audio/video file or enter a YouTube URL</p>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="flex items-center justify-center p-1 rounded-full bg-slate-700/50 mt-0.5">
                        <ChevronRight size={11} className="text-slate-400" />
                      </div>
                      <p>Our AI analyzes the content, detects speakers, and extracts topics</p>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="flex items-center justify-center p-1 rounded-full bg-slate-700/50 mt-0.5">
                        <ChevronRight size={11} className="text-slate-400" />
                      </div>
                      <p>Get a detailed transcript, summaries, and speaker statistics</p>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
          
          {/* Main Content Area */}
          <div className="lg:col-span-9">
            <div className="space-y-8">
              {/* Results Title */}
              <h2 className="text-xl font-medium text-slate-100 mb-4">
                {processing 
                  ? "Processing Content..." 
                  : isLoadingResult 
                    ? "Loading Results..." 
                    : jobId && !result?.metadata 
                      ? "Waiting for processing to complete..." 
                      : result?.metadata?.title || result?.metadata
                        ? result.metadata.title || "Podcast Analysis"
                        : "Upload content to begin"}
              </h2>
                
              {/* Processing State */}
              {(processing || isLoadingResult) && (
                <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700/40 shadow-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    <h3 className="text-lg font-medium text-slate-200">
                      {isLoadingResult ? "Loading Results" : "Processing Your Content"}
                    </h3>
                  </div>
                  
                  {processing && (
                    <>
                      <p className="text-slate-300 mb-4">
                        {progress < 40 
                          ? "Uploading your content..." 
                          : progress < 85 
                            ? "Analyzing audio and generating results..." 
                            : "Almost done, finalizing..."}
                      </p>
                      <div className="mt-5">
                        <div className="flex justify-between text-xs mb-2">
                          <span className="text-slate-300">
                            {progress < 20 ? "Initializing" : progress < 70 ? "Processing" : progress < 100 ? "Analyzing" : "Complete"}
                          </span>
                          <span className="font-medium text-slate-300">{progress}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full overflow-hidden bg-slate-800/70">
                          <div 
                            style={{ width: `${progress}%` }}
                            className="h-full bg-blue-500 transition-all duration-300"
                          />
                        </div>
                      </div>
                    </>
                  )}
                  
                  {isLoadingResult && (
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-blue-400 animate-spin mr-3" />
                      <span className="text-slate-200">Loading your results...</span>
                    </div>
                  )}
                </div>
              )}
                
              {/* Results */}
              {result && !processing && !isLoadingResult && renderResults()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}