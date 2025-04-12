from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional, Dict, Union, Any

# Standard library imports
import os
import sys
import logging
from pathlib import Path
from contextlib import contextmanager
import signal
import threading
import json

# Third-party imports
from dotenv import load_dotenv

# Add the backend directory to the path if needed
current_dir = Path(__file__).parent
if str(current_dir) not in sys.path:
    sys.path.append(str(current_dir))
    # Also add the parent directory to handle both ways of running
    sys.path.append(str(current_dir.parent))

# Suppress torchaudio deprecation warnings
import warnings
warnings.filterwarnings("ignore", message="torchaudio._backend.*has been deprecated")
warnings.filterwarnings("ignore", message="torchaudio.backend.common.AudioMetaData.*has been moved")

# Initialize environment
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Import for NLTK initialization
try:
    from init_nltk import download_nltk_data
    # Download NLTK data on startup if not already downloaded
    download_nltk_data()
except ImportError:
    try:
        from backend.init_nltk import download_nltk_data
        download_nltk_data()
    except Exception as e:
        logger.error(f"Failed to download NLTK data: {str(e)}")

# Import all processors
try:
    from transcription import WhisperTranscriber
    from diarization import SpeakerDiarization
    from summarization import ExtractiveSummarizer, AbstractiveSummarizer
    from topic_detection import TopicDetector
    from audio_processing import AudioProcessor
    from youtube_downloader import YouTubeDownloader
    logger.info("Imported processors successfully")
except ImportError:
    try:
        from backend.transcription import WhisperTranscriber
        from backend.diarization import SpeakerDiarization
        from backend.summarization import ExtractiveSummarizer, AbstractiveSummarizer
        from backend.topic_detection import TopicDetector
        from backend.audio_processing import AudioProcessor
        from backend.youtube_downloader import YouTubeDownloader
        logger.info("Imported processors successfully")
    except ImportError as e:
        logger.error(f"Failed to import processors: {str(e)}")
        raise

# Create uploads directory
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(exist_ok=True)

# Check for Hugging Face access token
HF_ACCESS_TOKEN = os.environ.get("HF_ACCESS_TOKEN")
if not HF_ACCESS_TOKEN or HF_ACCESS_TOKEN == "your_huggingface_token_here":
    logger.warning("HF_ACCESS_TOKEN not set in environment variables. Speaker diarization will not work correctly.")
    logger.warning("Please set the HF_ACCESS_TOKEN environment variable with your Hugging Face access token.")
    logger.warning("You can generate a token at https://huggingface.co/settings/tokens")

# Initialize FastAPI
app = FastAPI(
    title="Podcast Processing API",
    description="API for podcast transcription, summarization, and analysis",
    version="1.0.0"
)

# Add CORS middleware
# Get allowed origins from environment or use localhost as default
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

# Log warning if wildcard is used in production
if "*" in ALLOWED_ORIGINS:
    logger.warning("WARNING: CORS is configured to allow requests from any origin (*)")
    logger.warning("This is not recommended for production environments")
    logger.warning("Set ALLOWED_ORIGINS env var to a comma-separated list of allowed origins")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # Use specific origins rather than wildcard
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define response models
class ProcessingResponse(BaseModel):
    """Response model for processing results."""
    message: str
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class ProcessResponse(BaseModel):
    """Response model for processing requests."""
    job_id: str
    status: str
    file_name: str
    error: Optional[str] = None

# Timeout handler for long-running operations
class TimeoutError(Exception):
    pass

@contextmanager
def time_limit(seconds):
    """
    Context manager for setting a timeout on operations - platform independent version.
    Uses SIGALRM on Unix systems and threading on Windows.
    """
    # Check if running on Windows or Unix
    is_windows = sys.platform.startswith('win')
    
    if not is_windows and seconds > 0:
        # Use SIGALRM on Unix systems
        def signal_handler(signum, frame):
            raise TimeoutError(f"Operation timed out after {seconds} seconds")
            
        signal.signal(signal.SIGALRM, signal_handler)
        signal.alarm(seconds)
        try:
            yield
        finally:
            signal.alarm(0)
    else:
        # On Windows, use threading with a timer
        timer = None
        timeout_occurred = False
        current_thread = threading.current_thread()
        
        def timeout_handler():
            nonlocal timeout_occurred
            timeout_occurred = True
            # Raise an exception in the main thread (not foolproof but works for many cases)
            logging.error(f"Operation timed out after {seconds} seconds")
        
        if seconds > 0:
            timer = threading.Timer(seconds, timeout_handler)
            timer.daemon = True
            timer.start()
        
        try:
            yield
            # Periodically check if timeout occurred
            if timeout_occurred:
                raise TimeoutError(f"Operation timed out after {seconds} seconds")
        finally:
            if timer:
                timer.cancel()

# Get timeouts from environment variables
DIARIZATION_TIMEOUT = int(os.environ.get("DIARIZATION_TIMEOUT", 300))  # 5 minutes default
TOPIC_DETECTION_TIMEOUT = int(os.environ.get("TOPIC_DETECTION_TIMEOUT", 120))  # 2 minutes default
SUMMARIZATION_TIMEOUT = int(os.environ.get("SUMMARIZATION_TIMEOUT", 60))  # 1 minute default

# Helper function to make objects JSON serializable
def make_serializable(obj):
    """Convert non-serializable objects to serializable types."""
    if isinstance(obj, Path):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

# Health check endpoint
@app.get("/api/healthcheck")
def healthcheck():
    """
    Health check endpoint to verify API is running.
    """
    return {"status": "ok", "service": "Podcast Processing API"}

# Root path redirect
@app.get("/")
def read_root():
    """Redirect root path to API docs."""
    return RedirectResponse(url="/docs")

@app.get("/api")
def read_api_root():
    """Get API info."""
    return {
        "name": "Podcast Processing API",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc"
    }

# File Upload Endpoint
@app.post("/api/upload", response_model=ProcessResponse)
async def process_upload(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    """
    Upload and process an audio file
    """
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    # Generate a unique job ID
    import uuid
    job_id = str(uuid.uuid4())
    
    # Get file extension and create a unique filename
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{job_id}{file_extension}"
    file_path = UPLOAD_DIR / unique_filename
    
    try:
        # Save the uploaded file
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        logger.info(f"File saved as {file_path}")
        
        # Process the file in the background
        if background_tasks:
            background_tasks.add_task(
                process_audio_file, 
                file_path=file_path,
                job_id=job_id
            )
        
        return {
            "job_id": job_id,
            "status": "processing",
            "file_name": file.filename
        }
    
    except Exception as e:
        logger.error(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

# YouTube URL Processing Endpoint
@app.post("/api/youtube", response_model=ProcessResponse)
async def process_youtube(url: str = Form(...), background_tasks: BackgroundTasks = None):
    """
    Process a YouTube URL
    """
    if not url:
        raise HTTPException(status_code=400, detail="No YouTube URL provided")
    
    # Generate a unique job ID
    import uuid
    job_id = str(uuid.uuid4())
    
    try:
        # Create YouTube downloader
        youtube_dl = YouTubeDownloader(download_dir=UPLOAD_DIR)
        
        # Download the YouTube video (audio only)
        download_result = youtube_dl.download_audio(url)
        
        if download_result.get('error'):
            raise HTTPException(status_code=400, detail=download_result['error'])
        
        file_path = download_result.get('file_path')
        
        if not file_path or not os.path.exists(file_path):
            raise HTTPException(status_code=500, detail="Failed to download YouTube audio")
        
        # Process the file in the background
        if background_tasks:
            background_tasks.add_task(
                process_audio_file, 
                file_path=file_path,
                job_id=job_id,
                metadata={
                    "source": "youtube",
                    "url": url,
                    "video_title": download_result.get('title', ''),
                    "video_author": download_result.get('uploader', ''),
                    "duration": download_result.get('duration', 0)
                }
            )
        
        return {
            "job_id": job_id,
            "status": "processing",
            "file_name": os.path.basename(file_path)
        }
    
    except Exception as e:
        logger.error(f"Error processing YouTube URL: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing YouTube URL: {str(e)}")

# Get Results Endpoint
@app.get("/api/results/{job_id}")
async def get_results(job_id: str):
    """
    Get processing results for a specific job
    """
    # Check if the results file exists
    results_file = UPLOAD_DIR / f"{job_id}_results.json"
    
    if not results_file.exists():
        return JSONResponse(
            status_code=202,
            content={
                "job_id": job_id,
                "status": "processing",
                "message": "Still processing. Please try again later."
            }
        )
    
    try:
        with open(results_file, 'r') as f:
            results = json.load(f)
        
        return results
    
    except Exception as e:
        logger.error(f"Error retrieving results for job {job_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving results: {str(e)}")

# Audio Processing Function (runs in background)
async def process_audio_file(file_path, job_id, metadata=None):
    """Process an audio file with all available processors"""
    try:
        logger.info(f"Starting processing for job {job_id} - file: {file_path}")
        
        # Initialize results dictionary
        results = {
            "job_id": job_id,
            "status": "completed",
            "error": None
        }
        
        # Create audio processor
        try:
            audio_processor = AudioProcessor()
            logger.info(f"Audio processor initialized for job {job_id}")
        except Exception as e:
            logger.error(f"Error initializing audio processor for job {job_id}: {str(e)}")
            results["warning"] = f"Error initializing audio processor: {str(e)}"
            # Continue with other processors if possible
        
        # Extract audio metadata
        try:
            audio_metadata = audio_processor.extract_metadata(file_path)
            
            if metadata:
                # Merge with provided metadata
                audio_metadata.update(metadata)
            
            # Add file info
            audio_metadata["file_path"] = str(file_path)
            audio_metadata["audio_url"] = f"/api/audio/{os.path.basename(file_path)}"
            
            # Save metadata
            results["metadata"] = audio_metadata
        except Exception as e:
            logger.error(f"Error extracting metadata for job {job_id}: {str(e)}")
            results["metadata"] = {
                "error": f"Failed to extract metadata: {str(e)}",
                "file_path": str(file_path),
                "audio_url": f"/api/audio/{os.path.basename(file_path)}"
            }
        
        # Initialize transcriber with proper error handling
        transcriber = None
        try:
            whisper_size = os.environ.get("WHISPER_MODEL_SIZE", "base")
            transcriber = WhisperTranscriber(model_size=whisper_size)
            
            # Check if we're in mock mode (Whisper not available)
            if transcriber._mock_mode:
                logger.warning(f"Running in mock mode for job {job_id} - Whisper not available")
                results["warning"] = "Running in mock mode - Whisper not available. Results may be limited."
        except Exception as e:
            logger.error(f"Error creating transcriber for job {job_id}: {str(e)}")
            results["warning"] = f"Error initializing transcriber: {str(e)}"
            results["transcript"] = "Error: Transcription failed due to initialization error."
            results["segments"] = []
            
            # Save results early since we can't proceed with transcription
            results_file = UPLOAD_DIR / f"{job_id}_results.json"
            with open(results_file, 'w') as f:
                json.dump(results, f, default=make_serializable)
            
            logger.error(f"Processing aborted for job {job_id} - transcriber initialization failed")
            return
        
        # Transcribe audio
        try:
            if transcriber:
                logger.info(f"Transcribing audio for job {job_id}")
                transcript_result = transcriber.transcribe(file_path)
                
                # Ensure transcript_result has expected format
                if isinstance(transcript_result, dict):
                    # Save transcript
                    results["transcript"] = transcript_result.get("text", "")
                    results["segments"] = transcript_result.get("segments", [])
                else:
                    # Handle case where transcribe returns a string (shouldn't happen now but be defensive)
                    logger.warning(f"Unexpected transcript result type for job {job_id}: {type(transcript_result)}")
                    if isinstance(transcript_result, str):
                        results["transcript"] = transcript_result
                    else:
                        results["transcript"] = f"Error: Unexpected transcription result type: {type(transcript_result)}"
                    results["segments"] = []
            else:
                logger.error(f"Transcriber not available for job {job_id}")
                results["transcript"] = "Error: Transcription service unavailable."
                results["segments"] = []
        except Exception as e:
            logger.error(f"Transcription error for job {job_id}: {str(e)}")
            results["transcript"] = f"Error: {str(e)}"
            results["segments"] = []
        
        # Check if we have valid transcript before proceeding with other steps
        if not results.get("transcript") or results.get("transcript").startswith("Error:"):
            logger.warning(f"No valid transcript for job {job_id}, skipping additional processing")
            
            # Save early results and return
            results_file = UPLOAD_DIR / f"{job_id}_results.json"
            with open(results_file, 'w') as f:
                json.dump(results, f, default=make_serializable)
            
            logger.info(f"Processing completed with errors for job {job_id}")
            return
        
        # Speaker diarization (with timeout)
        if HF_ACCESS_TOKEN and results.get("segments") and isinstance(results.get("segments"), list):
            try:
                # Skip diarization for very short content (< 10 seconds or < 5 segments)
                total_audio_duration = 0
                for segment in results.get("segments", []):
                    if isinstance(segment, dict) and "end" in segment:
                        total_audio_duration = max(total_audio_duration, segment["end"])
                
                if total_audio_duration < 10 or len(results.get("segments", [])) < 5:
                    logger.warning(f"Skipping diarization for job {job_id} - audio too short ({total_audio_duration:.1f}s, {len(results.get('segments', []))} segments)")
                    results["diarization"] = {"error": "Audio too short for speaker detection"}
                else:
                    with time_limit(DIARIZATION_TIMEOUT):
                        logger.info(f"Starting speaker diarization for job {job_id}")
                        diarizer = SpeakerDiarization(use_auth_token=HF_ACCESS_TOKEN)
                        transcript_data = {"segments": results["segments"]} if isinstance(results.get("segments"), list) else None
                        diarization_result = diarizer.diarize(file_path, transcript_data)
                        
                        if isinstance(diarization_result, dict):
                            results["diarization"] = diarization_result
                            # Only update segments if the diarization provided valid segments
                            if diarization_result.get("segments") and isinstance(diarization_result.get("segments"), list):
                                results["segments"] = diarization_result.get("segments", results["segments"])
                        else:
                            logger.warning(f"Unexpected diarization result type for job {job_id}: {type(diarization_result)}")
                            results["diarization"] = {"error": "Invalid diarization result format"}
            except TimeoutError:
                logger.warning(f"Speaker diarization timed out for job {job_id}")
                results["diarization"] = {"error": "Speaker diarization timed out"}
            except Exception as e:
                logger.error(f"Speaker diarization error for job {job_id}: {str(e)}")
                results["diarization"] = {"error": str(e)}
        else:
            if not HF_ACCESS_TOKEN:
                logger.warning(f"Skipping diarization for job {job_id} - HF_ACCESS_TOKEN not set")
                results["diarization"] = {"error": "Hugging Face access token not provided"}
            elif not results.get("segments") or not isinstance(results.get("segments"), list):
                logger.warning(f"Skipping diarization for job {job_id} - No valid segments available")
                results["diarization"] = {"error": "No valid segments available for diarization"}
        
        # Topic detection (with timeout)
        if results.get("transcript") and not results.get("transcript").startswith("Error:"):
            try:
                with time_limit(TOPIC_DETECTION_TIMEOUT):
                    logger.info(f"Detecting topics for job {job_id}")
                    
                    # Check if transcript is too short for meaningful topic detection
                    if len(results["transcript"].split()) < 30:
                        logger.warning(f"Transcript too short for topic detection for job {job_id}")
                        results["topics"] = []
                    else:
                        topic_detector = TopicDetector()
                        topics_result = topic_detector.detect_topics(results["transcript"])
                        
                        # Remember topics_result is already a list of dictionaries
                        if isinstance(topics_result, list):
                            results["topics"] = topics_result
                        else:
                            logger.warning(f"Unexpected topic detection result type for job {job_id}: {type(topics_result)}")
                            results["topics"] = []
            except TimeoutError:
                logger.warning(f"Topic detection timed out for job {job_id}")
                results["topics"] = []
            except Exception as e:
                logger.error(f"Topic detection error for job {job_id}: {str(e)}")
                results["topics"] = []
        else:
            logger.warning(f"Skipping topic detection for job {job_id} - No valid transcript")
            results["topics"] = []
        
        # Summarization (with timeout)
        if results.get("transcript") and not results.get("transcript").startswith("Error:"):
            try:
                with time_limit(SUMMARIZATION_TIMEOUT):
                    logger.info(f"Generating summaries for job {job_id}")
                    
                    # Check if transcript is too short for meaningful summarization
                    if len(results["transcript"].split()) < 30:
                        logger.warning(f"Transcript too short for summarization for job {job_id}")
                        results["abstractive_summary"] = "The content is too short for a meaningful summary."
                        results["extractive_summary"] = ["The content is too short for extracting key points."]
                    else:
                        # Extractive summary
                        try:
                            ext_summarizer = ExtractiveSummarizer()
                            extractive_result = ext_summarizer.summarize(results["transcript"])
                            
                            # ExtractiveSummarizer now returns a dict with 'summary' key containing a list
                            if isinstance(extractive_result, dict) and "summary" in extractive_result:
                                results["extractive_summary"] = extractive_result["summary"]
                            else:
                                logger.warning(f"Unexpected extractive summary result for job {job_id}: {type(extractive_result)}")
                                results["extractive_summary"] = ["Error generating extractive summary"]
                        except Exception as e:
                            logger.error(f"Extractive summarization error for job {job_id}: {str(e)}")
                            results["extractive_summary"] = [f"Error: {str(e)}"]
                        
                        # Abstractive summary
                        try:
                            abs_summarizer = AbstractiveSummarizer()
                            abstractive_result = abs_summarizer.summarize(results["transcript"])
                            
                            # AbstractiveSummarizer now returns a dict with 'summary' key containing a string
                            if isinstance(abstractive_result, dict) and "summary" in abstractive_result:
                                results["abstractive_summary"] = abstractive_result["summary"]
                            else:
                                logger.warning(f"Unexpected abstractive summary result for job {job_id}: {type(abstractive_result)}")
                                results["abstractive_summary"] = "Error generating abstractive summary"
                        except Exception as e:
                            logger.error(f"Abstractive summarization error for job {job_id}: {str(e)}")
                            results["abstractive_summary"] = f"Error: {str(e)}"
            except TimeoutError:
                logger.warning(f"Summarization timed out for job {job_id}")
                results["abstractive_summary"] = "Summarization timed out"
                results["extractive_summary"] = ["Summarization timed out"]
            except Exception as e:
                logger.error(f"Summarization error for job {job_id}: {str(e)}")
                results["abstractive_summary"] = f"Error: {str(e)}"
                results["extractive_summary"] = [f"Error: {str(e)}"]
        else:
            logger.warning(f"Skipping summarization for job {job_id} - No valid transcript")
            results["abstractive_summary"] = "Summarization skipped - No valid transcript"
            results["extractive_summary"] = ["Summarization skipped - No valid transcript"]
        
        # Save results to file
        results_file = UPLOAD_DIR / f"{job_id}_results.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, default=make_serializable)
        
        logger.info(f"Processing completed for job {job_id}")
        
    except Exception as e:
        logger.error(f"Processing error for job {job_id}: {str(e)}")
        # Save error to results file
        results_file = UPLOAD_DIR / f"{job_id}_results.json"
        try:
            with open(results_file, 'w') as f:
                json.dump({
                    "job_id": job_id,
                    "status": "error",
                    "error": str(e)
                }, f)
        except Exception as write_error:
            logger.critical(f"Failed to write error results for job {job_id}: {str(write_error)}")

# Serve audio files
@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    """
    Serve an audio file from the uploads directory
    """
    file_path = UPLOAD_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path)

# Audio trimming endpoint
@app.post("/api/trim")
async def trim_audio(
    file_path: str = Form(...),
    start_time: float = Form(...),
    end_time: float = Form(...)
):
    """
    Trim an audio file to the specified start and end times
    """
    try:
        # Fix file path if it's a URL
        if file_path.startswith("/api/audio/"):
            # Extract filename from URL
            filename = file_path.split("/")[-1]
            file_path = UPLOAD_DIR / filename
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        # Create audio processor
        audio_processor = AudioProcessor()
        
        # Trim audio
        trimmed_file = audio_processor.trim_audio(
            file_path=file_path,
            start_time=start_time,
            end_time=end_time
        )
        
        # Get the filename
        trimmed_filename = os.path.basename(trimmed_file)
        
        return {
            "trimmed_file_url": f"/api/audio/{trimmed_filename}",
            "start_time": start_time,
            "end_time": end_time
        }
    
    except Exception as e:
        logger.error(f"Error trimming audio: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error trimming audio: {str(e)}")

# Trim by summary points
@app.post("/api/trim_by_summary")
async def trim_by_summary(
    file_path: str = Form(...),
    summary_points: str = Form(...),
    padding_seconds: float = Form(3.0)
):
    """
    Trim audio based on selected summary points
    """
    try:
        # Fix file path if it's a URL
        if file_path.startswith("/api/audio/"):
            # Extract filename from URL
            filename = file_path.split("/")[-1]
            file_path = UPLOAD_DIR / filename
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        # Create audio processor
        audio_processor = AudioProcessor()
        
        # Parse summary points - it's a string, so we need to convert it
        try:
            # It could be a JSON string
            summary_points_list = json.loads(summary_points)
        except:
            # If not JSON, it might be a comma-separated list
            summary_points_list = summary_points.split(",")
        
        # Find segments corresponding to the summary points
        # For now, we'll create dummy segments at regular intervals
        segments = []
        
        # Get audio duration
        try:
            import ffmpeg
            probe = ffmpeg.probe(file_path)
            duration = float(probe['format']['duration'])
            
            # Create evenly spaced segments for each summary point
            segment_duration = duration / len(summary_points_list)
            for i, summary in enumerate(summary_points_list):
                start_time = i * segment_duration
                end_time = start_time + min(20, segment_duration)  # Cap at 20 seconds
                segments.append({
                    'start': start_time,
                    'end': end_time,
                    'text': summary
                })
        except Exception as e:
            logger.error(f"Error getting audio duration: {str(e)}")
            # Fallback to simple segments
            for i, summary in enumerate(summary_points_list):
                segments.append({
                    'start': i * 30,  # 30 seconds apart
                    'end': (i * 30) + 15,  # 15 second segments
                    'text': summary
                })
        
        # Merge close segments and add padding
        merged_segments = audio_processor.merge_segments(segments, padding_seconds)
        
        # Trim audio to multiple segments
        trimmed_file = audio_processor.trim_to_highlights(
            file_path=file_path,
            segments=merged_segments
        )
        
        # Get the filename
        trimmed_filename = os.path.basename(trimmed_file)
        
        return {
            "trimmed_file_url": f"/api/audio/{trimmed_filename}",
            "segments": merged_segments
        }
    
    except Exception as e:
        logger.error(f"Error trimming by summary: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error trimming by summary: {str(e)}")


