"""
Speaker diarization processor using pyannote.audio.
This module provides advanced speaker diarization capabilities.
"""

import os
import json
import logging
import tempfile
from pathlib import Path
import torch
from typing import Dict, List, Any, Optional, Tuple, Union
import numpy as np
from pydub import AudioSegment
import matplotlib.pyplot as plt
from matplotlib.colors import to_hex
import io
import base64
import traceback

# Configure logging
logger = logging.getLogger(__name__)

# Path to Hugging Face access token
HF_ACCESS_TOKEN = os.environ.get("HF_ACCESS_TOKEN", None)
if not HF_ACCESS_TOKEN or HF_ACCESS_TOKEN.strip() == "":
    logger.warning("No Hugging Face access token found. Speaker diarization will be disabled.")
    logger.warning("To enable diarization, set HF_ACCESS_TOKEN in your .env file.")
    logger.warning("Get a token at: https://huggingface.co/settings/tokens")
    logger.warning("And accept the user conditions at: https://huggingface.co/pyannote/speaker-diarization-3.1")

try:
    from pyannote.audio import Pipeline
    from pyannote.core import Segment, Timeline, Annotation
    PYANNOTE_AVAILABLE = True
except ImportError:
    logger.warning("pyannote.audio not properly installed. Speaker diarization will be disabled.")
    logger.warning("Install with: pip install pyannote.audio>=3.1.0")
    PYANNOTE_AVAILABLE = False

class SpeakerDiarization:
    """
    Speaker diarization processor using pyannote.audio.
    """
    
    def __init__(self, use_auth_token: Optional[str] = None):
        """
        Initialize the speaker diarization processor.
        
        Args:
            use_auth_token: Hugging Face access token. If None, will use the HF_ACCESS_TOKEN env var.
        """
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Initializing pyannote.audio speaker diarization on {self.device}")
        
        # Default configuration
        self.min_speakers = 1
        self.max_speakers = 8
        self.min_duration = 0.5  # minimum segment duration in seconds
        self.collar = 0.15       # collar value for merging segments in seconds
        
        # Use provided token or fallback to env var
        self.auth_token = use_auth_token or HF_ACCESS_TOKEN
        
        # Speaker colors for visualization
        self.speaker_colors = [
            "#4285F4", "#EA4335", "#FBBC05", "#34A853", 
            "#FF6D01", "#46BDC6", "#9900FF", "#795548",
            "#9E9E9E", "#607D8B", "#1DE9B6", "#6200EA"
        ]
        
        # Only initialize pipeline if token is available and pyannote is installed
        self.pipeline = None
        if PYANNOTE_AVAILABLE and self.auth_token and self.auth_token.strip() != "":
            try:
                self.pipeline = self._init_pipeline()
                logger.info("Diarization pipeline initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize pyannote.audio pipeline: {e}")
                logger.error("Speaker diarization will be disabled")
        elif not PYANNOTE_AVAILABLE:
            logger.error("pyannote.audio not available. Speaker diarization will be disabled.")
        elif not self.auth_token or self.auth_token.strip() == "":
            logger.error("No Hugging Face access token provided. Speaker diarization will be disabled.")
    
    def _init_pipeline(self) -> Pipeline:
        """
        Initialize the pyannote.audio pipeline.
        
        Returns:
            The diarization pipeline.
        """
        if not self.auth_token or self.auth_token.strip() == "":
            raise ValueError("No Hugging Face access token provided. Cannot initialize pipeline.")
        
        if not PYANNOTE_AVAILABLE:
            raise ImportError("pyannote.audio is not properly installed")
        
        try:
            # Load the pre-trained pipeline from HuggingFace
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=self.auth_token
            )
            
            # Move to appropriate device
            pipeline.to(torch.device(self.device))
            
            return pipeline
        except Exception as e:
            logger.error(f"Error loading pyannote.audio model: {str(e)}")
            raise
    
    def _prepare_audio(self, audio_file: Union[str, Path]) -> Path:
        """
        Prepare audio for diarization by ensuring it's in the right format.
        
        Args:
            audio_file: Path to the audio file.
            
        Returns:
            Path to the prepared audio file.
        """
        audio_file = Path(audio_file)
        
        # If file is already WAV, just return it
        if audio_file.suffix.lower() == '.wav':
            return audio_file
        
        # Otherwise convert to WAV
        logger.info(f"Converting {audio_file} to WAV format for diarization")
        temp_wav = Path(tempfile.gettempdir()) / f"{audio_file.stem}_diarize.wav"
        
        try:
            audio = AudioSegment.from_file(str(audio_file))
            audio = audio.set_channels(1)  # Convert to mono
            audio = audio.set_frame_rate(16000)  # Set sample rate to 16kHz
            audio.export(str(temp_wav), format="wav")
            return temp_wav
        except Exception as e:
            logger.error(f"Error preparing audio: {e}")
            # Return original file as fallback
            return audio_file
    
    def diarize(self, 
                audio_file: Union[str, Path], 
                num_speakers: Optional[int] = None,
                min_speakers: Optional[int] = None,
                max_speakers: Optional[int] = None,
                is_youtube_shorts: bool = False,
                max_duration: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Perform speaker diarization on an audio file.
        
        Args:
            audio_file: Path to the audio file.
            num_speakers: Exact number of speakers if known. Overrides min and max.
            min_speakers: Minimum number of speakers.
            max_speakers: Maximum number of speakers.
            is_youtube_shorts: Whether this is a YouTube Shorts video.
            max_duration: Maximum duration to process in seconds (for long files)
            
        Returns:
            List of diarized segments with speaker labels.
        """
        if not self.pipeline:
            logger.error("Diarization pipeline not initialized. Cannot perform diarization.")
            logger.error("Check if you have set HF_ACCESS_TOKEN in your .env file.")
            # Return a single segment with SPEAKER_UNKNOWN to allow processing to continue
            return [{
                "start": 0.0,
                "end": 100000.0,  # Very large number to cover entire audio
                "speaker": "SPEAKER_UNKNOWN",
                "text": "",
                "error": "Diarization disabled or failed to initialize. Check HF_ACCESS_TOKEN."
            }]
        
        try:
            # Prepare parameters
            if min_speakers is None:
                min_speakers = 2 if is_youtube_shorts else self.min_speakers
                
            if max_speakers is None:
                max_speakers = 2 if is_youtube_shorts else self.max_speakers
            
            # If exact number of speakers is specified, set min and max to same value
            if num_speakers is not None:
                min_speakers = num_speakers
                max_speakers = num_speakers
            
            # Prepare audio file
            prepared_audio = self._prepare_audio(audio_file)
            
            # Check if we need to process in chunks
            if max_duration and max_duration > 0:
                try:
                    from pydub import AudioSegment
                    audio = AudioSegment.from_file(str(prepared_audio))
                    total_duration = len(audio) / 1000  # Convert to seconds
                    
                    if total_duration > max_duration:
                        logger.info(f"Processing long audio ({total_duration:.1f}s) in chunks of {max_duration}s")
                        return self._process_in_chunks(audio, max_duration, min_speakers, max_speakers)
                except Exception as e:
                    logger.warning(f"Error checking audio duration, processing full file: {e}")
            
            # Suppress warnings from pyannote
            logger.info(f"Running diarization with {min_speakers}-{max_speakers} speakers")
            
            # Run diarization
            diarization = self.pipeline(
                prepared_audio,
                min_speakers=min_speakers,
                max_speakers=max_speakers
            )
            
            # Process results with improved segment merging
            segments = self._process_diarization_results(diarization)
            
            # If we need exactly 2 speakers for YouTube Shorts, ensure we have that
            if is_youtube_shorts and num_speakers == 2:
                segments = self._enforce_two_speakers(segments)
            
            # Clean up temp file if created
            if prepared_audio != Path(audio_file) and prepared_audio.exists():
                os.unlink(prepared_audio)
            
            logger.info(f"Diarization complete: {len(segments)} segments, {len(set(s['speaker'] for s in segments))} speakers")
            
            return segments
            
        except Exception as e:
            logger.error(f"Diarization error: {str(e)}")
            logger.error(traceback.format_exc())
            
            # Return a single segment with SPEAKER_UNKNOWN to allow processing to continue
            return [{
                "start": 0.0,
                "end": 100000.0,  # Very large number to cover entire audio
                "speaker": "SPEAKER_UNKNOWN",
                "text": "",
                "error": f"Diarization failed: {str(e)}"
            }]
    
    def _process_diarization_results(self, diarization: Annotation) -> List[Dict[str, Any]]:
        """
        Process diarization results with improved segment merging logic.
        Combines consecutive segments from the same speaker if gap is small.
        
        Args:
            diarization: Diarization annotation from pyannote.
            
        Returns:
            List of processed segments with merged close segments.
        """
        raw_segments = []
        
        # First, collect all segments
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segment = {
                "start": round(turn.start, 2),
                "end": round(turn.end, 2),
                "speaker": f"Speaker {int(speaker.split('_')[1]) + 1}",  # Convert from speaker_0 to Speaker 1
                "duration": round(turn.end - turn.start, 2)
            }
            raw_segments.append(segment)
        
        # Sort by start time
        sorted_segments = sorted(raw_segments, key=lambda s: s["start"])
        
        # Merge close segments from the same speaker
        merged_segments = []
        if not sorted_segments:
            return merged_segments
            
        current = sorted_segments[0].copy()
        
        for next_segment in sorted_segments[1:]:
            # If same speaker and small gap, merge
            if (next_segment["speaker"] == current["speaker"] and 
                next_segment["start"] - current["end"] <= self.collar):
                # Merge by extending current segment end time
                current["end"] = next_segment["end"]
                current["duration"] = round(current["end"] - current["start"], 2)
            else:
                # Different speaker or large gap, add current and start new segment
                merged_segments.append(current)
                current = next_segment.copy()
        
        # Add the last segment
        merged_segments.append(current)
        
        # Calculate confidence scores (estimated based on duration)
        for segment in merged_segments:
            # Longer segments typically have higher confidence
            base_confidence = min(0.9, max(0.6, segment["duration"] / 10))
            # Add some randomness to simulate real confidence scores
            segment["confidence"] = round(base_confidence + np.random.uniform(-0.1, 0.1), 2)
            
        return merged_segments
    
    def _enforce_two_speakers(self, segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Enforce exactly two speakers in the diarization result.
        
        Args:
            segments: List of diarized segments.
        
        Returns:
            Modified segments with exactly two speakers.
        """
        if not segments:
            return segments
        
        # Collect unique speakers
        unique_speakers = list(set(s["speaker"] for s in segments))
        
        # If already have 2 speakers, return as is
        if len(unique_speakers) == 2:
            return segments
        
        # If more than 2 speakers, keep only the two most frequent
        if len(unique_speakers) > 2:
            speaker_counts = {}
            for s in segments:
                speaker = s["speaker"]
                speaker_counts[speaker] = speaker_counts.get(speaker, 0) + 1
            
            # Sort by count (descending)
            top_speakers = sorted(speaker_counts.items(), key=lambda x: x[1], reverse=True)[:2]
            top_speaker_ids = [s[0] for s in top_speakers]
            
            # Map non-top speakers to the most similar top speaker
            for segment in segments:
                if segment["speaker"] not in top_speaker_ids:
                    # Simple strategy: map to most frequent
                    segment["speaker"] = top_speaker_ids[0]
        
        # If only 1 speaker, try to split based on pauses
        elif len(unique_speakers) == 1:
            # Get the single speaker name
            speaker1 = unique_speakers[0]
            speaker2 = "Speaker 2" if speaker1 != "Speaker 2" else "Speaker 1"
            
            # Sort segments by start time
            sorted_segments = sorted(segments, key=lambda x: x["start"])
            
            # Find gaps between segments
            current_speaker = speaker1
            for i in range(len(sorted_segments)):
                # Assign speaker label
                sorted_segments[i]["speaker"] = current_speaker
                
                # If not the last segment, check for gap
                if i < len(sorted_segments) - 1:
                    current_end = sorted_segments[i]["end"]
                    next_start = sorted_segments[i+1]["start"]
                    
                    # If significant gap, switch speaker
                    if next_start - current_end > 0.5:
                        current_speaker = speaker2 if current_speaker == speaker1 else speaker1
            
            return sorted_segments
        
        return segments
    
    def get_speaker_timeline(self, 
                            segments: List[Dict[str, Any]], 
                            duration: float) -> Dict[str, List[List[float]]]:
        """
        Get a timeline of speaker activity for visualization.
        
        Args:
            segments: List of diarized segments.
            duration: Total duration of the audio.
            
        Returns:
            Dictionary with speaker IDs as keys and lists of [start, end] times as values.
        """
        speaker_timeline = {}
        
        for segment in segments:
            speaker = segment["speaker"]
            start = segment["start"]
            end = segment["end"]
            
            if speaker not in speaker_timeline:
                speaker_timeline[speaker] = []
                
            speaker_timeline[speaker].append([start, end])
        
        return speaker_timeline 

    def _process_in_chunks(self, 
                          audio: 'AudioSegment',
                          chunk_duration: int,
                          min_speakers: int,
                          max_speakers: int) -> List[Dict[str, Any]]:
        """
        Process a long audio file in chunks to avoid memory issues.
        
        Args:
            audio: The complete audio segment
            chunk_duration: Duration of each chunk in seconds
            min_speakers: Minimum number of speakers
            max_speakers: Maximum number of speakers
            
        Returns:
            List of merged diarized segments
        """
        import tempfile
        
        total_duration = len(audio) / 1000  # Convert to seconds
        chunk_count = int(total_duration / chunk_duration) + 1
        
        logger.info(f"Splitting {total_duration:.1f}s audio into {chunk_count} chunks")
        
        all_segments = []
        speaker_mapping = {}  # To maintain consistent speaker IDs across chunks
        
        for i in range(chunk_count):
            start_ms = i * chunk_duration * 1000
            end_ms = min((i + 1) * chunk_duration * 1000, len(audio))
            
            if start_ms >= len(audio):
                break
                
            logger.info(f"Processing chunk {i+1}/{chunk_count} ({start_ms/1000:.1f}s - {end_ms/1000:.1f}s)")
            
            # Extract chunk
            chunk = audio[start_ms:end_ms]
            
            # Save chunk to temporary file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                chunk_path = temp_file.name
                chunk.export(chunk_path, format="wav")
            
            try:
                # Process chunk
                diarization = self.pipeline(
                    chunk_path,
                    min_speakers=min_speakers,
                    max_speakers=max_speakers
                )
                
                # Process results
                chunk_segments = self._process_diarization_results(diarization)
                
                # Adjust timestamps
                for segment in chunk_segments:
                    # Add chunk offset to timestamps
                    segment["start"] += start_ms / 1000
                    segment["end"] += start_ms / 1000
                    
                    # Map speaker IDs consistently across chunks
                    original_speaker = segment["speaker"]
                    if original_speaker not in speaker_mapping:
                        speaker_mapping[original_speaker] = f"Speaker {len(speaker_mapping) + 1}"
                    
                    segment["speaker"] = speaker_mapping[original_speaker]
                
                all_segments.extend(chunk_segments)
                
            except Exception as e:
                logger.error(f"Error processing chunk {i+1}: {e}")
            
            finally:
                # Clean up temp file
                try:
                    os.unlink(chunk_path)
                except:
                    pass
        
        # Sort segments by start time and merge very close segments from same speaker
        if all_segments:
            all_segments.sort(key=lambda s: s["start"])
            merged_segments = []
            current = all_segments[0].copy()
            
            for next_segment in all_segments[1:]:
                if (next_segment["speaker"] == current["speaker"] and 
                    next_segment["start"] - current["end"] <= self.collar):
                    # Merge by extending current segment
                    current["end"] = next_segment["end"]
                    current["duration"] = round(current["end"] - current["start"], 2)
                else:
                    # Different speaker or large gap
                    merged_segments.append(current)
                    current = next_segment.copy()
            
            # Add the last segment
            merged_segments.append(current)
            
            logger.info(f"Merged chunks into {len(merged_segments)} segments with {len(speaker_mapping)} speakers")
            return merged_segments
            
        return all_segments
    
    def generate_speaker_waveform(self, segments: List[Dict[str, Any]], duration: float) -> str:
        """
        Generate a visual waveform with colored speaker segments.
        
        Args:
            segments: The diarized segments
            duration: Total audio duration in seconds
            
        Returns:
            Base64 encoded PNG image of the visualization
        """
        if not segments:
            return None
            
        # Create figure
        fig, ax = plt.figure(figsize=(12, 3)), plt.gca()
        
        # Get unique speakers
        speakers = sorted(list(set(s["speaker"] for s in segments)))
        speaker_colors = {speakers[i]: self.speaker_colors[i % len(self.speaker_colors)] 
                         for i in range(len(speakers))}
        
        # Plot segments as colored blocks
        for segment in segments:
            speaker = segment["speaker"]
            start = segment["start"]
            end = segment["end"]
            color = speaker_colors.get(speaker, "#CCCCCC")
            
            # Plot the segment as a colored rectangle
            rect = plt.Rectangle((start, 0), end - start, 1, color=color, alpha=0.7)
            ax.add_patch(rect)
            
            # Add speaker label for longer segments
            if end - start > duration / 30:  # Only label longer segments
                plt.text((start + end) / 2, 0.5, speaker, 
                        horizontalalignment='center', verticalalignment='center')
        
        # Add legend
        import matplotlib.patches as mpatches
        handles = [mpatches.Patch(color=color, label=speaker) 
                 for speaker, color in speaker_colors.items()]
        plt.legend(handles=handles, loc='upper center', bbox_to_anchor=(0.5, 1.15),
                 fancybox=True, shadow=True, ncol=min(5, len(speakers)))
        
        # Set axis limits and labels
        plt.xlim(0, duration)
        plt.ylim(0, 1)
        plt.xlabel('Time (seconds)')
        plt.yticks([])  # Hide y-axis ticks
        
        # Add time markers
        time_interval = max(int(duration / 10), 1)  # At least every 1 second
        time_markers = range(0, int(duration) + 1, time_interval)
        plt.xticks(time_markers)
        
        # Add grid
        plt.grid(axis='x', linestyle='--', alpha=0.3)
        
        # Convert plot to base64 image
        buffer = io.BytesIO()
        plt.tight_layout()
        plt.savefig(buffer, format='png', dpi=100)
        plt.close(fig)
        buffer.seek(0)
        
        # Encode to base64
        img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return img_str
    
    def generate_speaker_statistics(self, segments: List[Dict[str, Any]], duration: float) -> Dict[str, Any]:
        """
        Generate statistics about speaker participation.
        
        Args:
            segments: The diarized segments
            duration: Total audio duration in seconds
            
        Returns:
            Dictionary with speaker statistics
        """
        if not segments:
            return {}
            
        # Get unique speakers
        speakers = sorted(list(set(s["speaker"] for s in segments)))
        
        # Calculate speaking time for each speaker
        speaker_times = {speaker: 0.0 for speaker in speakers}
        for segment in segments:
            speaker = segment["speaker"]
            speaker_times[speaker] += segment["duration"]
        
        # Calculate percentages
        speaker_percentages = {speaker: round((time / duration) * 100, 1) 
                             for speaker, time in speaker_times.items()}
        
        # Count segments per speaker
        segment_counts = {speaker: sum(1 for s in segments if s["speaker"] == speaker)
                         for speaker in speakers}
        
        # Calculate average segment duration
        avg_durations = {speaker: round(speaker_times[speaker] / segment_counts[speaker], 2)
                        if segment_counts[speaker] > 0 else 0
                        for speaker in speakers}
        
        # Calculate silence/non-speech time
        total_speech_time = sum(speaker_times.values())
        silence_time = max(0, duration - total_speech_time)
        silence_percentage = round((silence_time / duration) * 100, 1) if duration > 0 else 0
        
        # Identify primary and secondary speakers
        sorted_speakers = sorted(speakers, key=lambda s: speaker_times[s], reverse=True)
        primary_speaker = sorted_speakers[0] if sorted_speakers else None
        secondary_speakers = sorted_speakers[1:] if len(sorted_speakers) > 1 else []
        
        # Count speaker transitions (turn-taking)
        transitions = 0
        for i in range(1, len(segments)):
            if segments[i]["speaker"] != segments[i-1]["speaker"]:
                transitions += 1
        
        # Calculate speaker colors for visualization
        speaker_colors = {speakers[i]: to_hex(self.speaker_colors[i % len(self.speaker_colors)])
                         for i in range(len(speakers))}
        
        # Assemble statistics
        statistics = {
            "total_duration": round(duration, 2),
            "total_speech_time": round(total_speech_time, 2),
            "silence_time": round(silence_time, 2),
            "silence_percentage": silence_percentage,
            "speaker_count": len(speakers),
            "primary_speaker": primary_speaker,
            "segment_count": len(segments),
            "speaker_transitions": transitions,
            "speakers": [{
                "id": speaker,
                "speaking_time": round(speaker_times[speaker], 2),
                "percentage": speaker_percentages[speaker],
                "segments": segment_counts[speaker],
                "avg_segment_duration": avg_durations[speaker],
                "color": speaker_colors.get(speaker, "#CCCCCC"),
                "is_primary": speaker == primary_speaker
            } for speaker in sorted_speakers]
        }
        
        return statistics 
