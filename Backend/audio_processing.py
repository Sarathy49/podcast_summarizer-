import os
import logging
import tempfile
from pathlib import Path
from typing import Dict, Union, Optional, Tuple
import ffmpeg
import json
from datetime import datetime
from pydub import AudioSegment
import re

# Set up logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AudioProcessor:
    """
    Audio processing utilities for metadata extraction and trimming.
    """
    
    def __init__(self):
        """
        Initialize the audio processor.
        """
        pass
    
    def extract_metadata(self, file_path: Union[str, Path]) -> Dict:
        """
        Extract metadata from audio file.
        
        Args:
            file_path: Path to the file
            
        Returns:
            Dictionary of metadata
        """
        try:
            result = {}
            if not os.path.exists(file_path):
                logging.error(f"File not found: {file_path}")
                return {"error": "File not found"}
            
            # Store the file path in metadata for later use
            result["filepath"] = file_path
            
            try:
                # Try to get metadata using ffprobe
                probe = ffmpeg.probe(file_path)
                
                # Extract basic metadata
                if 'format' in probe:
                    fmt = probe['format']
                    if 'tags' in fmt:
                        tags = fmt['tags']
                        # Extract common audio tags if present
                        for tag in ['title', 'artist', 'album', 'track', 'genre', 'date']:
                            if tag in tags:
                                result[tag] = tags[tag]
                    
                    # Add format info
                    if 'format_name' in fmt:
                        result['format'] = fmt['format_name']
                    
                    # Add duration
                    if 'duration' in fmt:
                        duration_secs = float(fmt['duration'])
                        result['duration'] = self._format_duration(duration_secs)
                    
                    # Add file size
                    if 'size' in fmt:
                        size_bytes = int(fmt['size'])
                        result['filesize'] = self._format_file_size(size_bytes)
                
                # Extract audio stream info
                audio_streams = [s for s in probe['streams'] if s['codec_type'] == 'audio']
                if audio_streams:
                    audio = audio_streams[0]
                    
                    # Bitrate
                    if 'bit_rate' in audio:
                        bitrate = int(audio['bit_rate'])
                        result['bitrate'] = f"{int(bitrate / 1000)} kbps"
                    
                    # Sample rate
                    if 'sample_rate' in audio:
                        result['sample_rate'] = f"{audio['sample_rate']} Hz"
                    
                    # Channels
                    if 'channels' in audio:
                        result['channels'] = audio['channels']
            
            except Exception as e:
                logging.warning(f"Error extracting metadata with ffprobe: {str(e)}")
                # Fall back to basic metadata extraction
                
                # Use pydub to get basic info
                try:
                    audio = AudioSegment.from_file(file_path)
                    result['duration'] = self._format_duration(audio.duration_seconds)
                    result['channels'] = audio.channels
                    result['sample_rate'] = f"{audio.frame_rate} Hz"
                    
                    # Get file size
                    size_bytes = os.path.getsize(file_path)
                    result['filesize'] = self._format_file_size(size_bytes)
                    
                    # Try to guess format from extension
                    _, ext = os.path.splitext(file_path)
                    if ext:
                        result['format'] = ext[1:].lower()  # Remove the dot
                except Exception as inner_e:
                    logging.error(f"Error extracting basic metadata: {str(inner_e)}")
            
            return result
        except Exception as e:
            logging.error(f"Error in extract_metadata: {str(e)}")
            return {"error": str(e)}
    
    def trim(self, file_path: Union[str, Path], start_time: float, end_time: float) -> Path:
        """
        Trim audio file based on start and end times.
        
        Args:
            file_path: Path to the file
            start_time: Start time in seconds
            end_time: End time in seconds
            
        Returns:
            Path to the trimmed file
        """
        file_path = Path(file_path)
        
        try:
            logger.info(f"Trimming audio {file_path} from {start_time}s to {end_time}s")
            
            # Create output file path
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = file_path.parent
            output_filename = f"{file_path.stem}_trimmed_{timestamp}{file_path.suffix}"
            output_path = output_dir / output_filename
            
            # Run ffmpeg to trim the file
            (
                ffmpeg
                .input(str(file_path), ss=start_time, to=end_time)
                .output(str(output_path), c="copy")
                .overwrite_output()
                .run(quiet=False, capture_stdout=True, capture_stderr=True)
            )
            
            logger.info(f"Audio file trimmed successfully: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Error trimming audio file: {str(e)}")
            raise
    
    def _format_duration(self, seconds: float) -> str:
        """
        Format duration in seconds to MM:SS format.
        
        Args:
            seconds: Duration in seconds
            
        Returns:
            Formatted duration string
        """
        minutes = int(seconds // 60)
        seconds = int(seconds % 60)
        return f"{minutes:02d}:{seconds:02d}"

    def _format_file_size(self, size_bytes):
        """Format file size in bytes to human-readable format"""
        if size_bytes < 1024:
            return f"{size_bytes} bytes"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

    def trim_audio_by_key_points(self, input_file, segments, summary_points, output_file=None, padding_seconds=3.0):
        """
        Trim audio to include only segments that contain key points from the extractive summary.
        
        Args:
            input_file: Path to input audio file
            segments: List of transcript segments with timestamps
            summary_points: List of key points from extractive summary
            output_file: Path to output trimmed audio file (generated if None)
            padding_seconds: Seconds of audio to include before and after each key point
            
        Returns:
            Path to trimmed audio file
        """
        logging.info(f"Trimming audio based on extractive summary key points")
        
        # Generate output filename if not provided
        if not output_file:
            base_name = os.path.splitext(os.path.basename(input_file))[0]
            output_file = os.path.join(os.path.dirname(input_file), f"{base_name}_trimmed.mp3")
        
        # Load the audio file
        try:
            audio = AudioSegment.from_file(input_file)
        except Exception as e:
            logging.error(f"Failed to load audio file: {str(e)}")
            raise RuntimeError(f"Failed to load audio file: {str(e)}")
        
        # Find segments that contain key points
        key_segments = []
        for point in summary_points:
            point_text = point.lower().strip()
            # Find the segment that contains this key point
            for segment in segments:
                segment_text = segment.get('text', '').lower().strip()
                # Check if the key point is contained in this segment
                # Use fuzzy matching to handle slight differences in text
                if (point_text in segment_text or 
                    self._calculate_text_similarity(point_text, segment_text) > 0.75):
                    start_time = max(0, segment.get('start', 0) - padding_seconds) * 1000  # convert to ms
                    end_time = min(len(audio), segment.get('end', 0) + padding_seconds) * 1000  # convert to ms
                    key_segments.append({
                        'start': start_time,
                        'end': end_time,
                        'text': segment.get('text', '')
                    })
                    break
        
        # Sort segments by start time
        key_segments.sort(key=lambda x: x['start'])
        
        # Merge overlapping segments
        merged_segments = []
        if key_segments:
            current_segment = key_segments[0]
            for segment in key_segments[1:]:
                if segment['start'] <= current_segment['end']:
                    # Segments overlap, merge them
                    current_segment['end'] = max(current_segment['end'], segment['end'])
                else:
                    # No overlap, add current segment to result and move to next
                    merged_segments.append(current_segment)
                    current_segment = segment
            merged_segments.append(current_segment)
        
        # Check if we found any segments to include
        if not merged_segments:
            logging.warning("No key segments found in transcript for summary points")
            return input_file
        
        # Create the output audio file from the merged segments
        logging.info(f"Creating trimmed audio with {len(merged_segments)} key segments")
        output_audio = AudioSegment.empty()
        
        for i, segment in enumerate(merged_segments):
            start_ms = int(segment['start'])
            end_ms = int(segment['end'])
            
            # Add segment to output
            segment_audio = audio[start_ms:end_ms]
            output_audio += segment_audio
            
            # Add a short silence between segments, except after the last one
            if i < len(merged_segments) - 1:
                output_audio += AudioSegment.silent(duration=500)  # 500ms of silence
                
        # Export the output audio
        logging.info(f"Exporting trimmed audio to {output_file}")
        output_audio.export(output_file, format="mp3")
        
        return output_file

    def _calculate_text_similarity(self, text1, text2):
        """
        Calculate similarity between two text strings.
        
        Args:
            text1: First text string
            text2: Second text string
            
        Returns:
            Similarity score between 0 and 1
        """
        # Simple similarity based on word overlap
        # This could be replaced with more sophisticated methods
        words1 = set(re.findall(r'\b\w+\b', text1.lower()))
        words2 = set(re.findall(r'\b\w+\b', text2.lower()))
        
        if not words1 or not words2:
            return 0
            
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        jaccard_similarity = len(intersection) / len(union)
        return jaccard_similarity 

    def trim_audio(self, file_path: Union[str, Path], start_time: float, end_time: float) -> str:
        """
        Trim audio file to specified start and end times.
        Interface method for API that calls the internal trim method.
        
        Args:
            file_path: Path to the audio file
            start_time: Start time in seconds
            end_time: End time in seconds
            
        Returns:
            Path to the trimmed file as string
        """
        try:
            # Ensure file exists
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
                
            # Validate time values
            if start_time < 0:
                start_time = 0
                
            # Get file duration
            try:
                probe = ffmpeg.probe(file_path)
                duration = float(probe['format']['duration'])
                
                if end_time > duration:
                    end_time = duration
                    
                if start_time >= end_time:
                    raise ValueError("Start time must be less than end time")
            except Exception as e:
                logger.warning(f"Error checking duration: {str(e)}")
            
            # Call the internal trim method
            output_path = self.trim(file_path, start_time, end_time)
            
            return str(output_path)
        except Exception as e:
            logger.error(f"Error in trim_audio: {str(e)}")
            raise
    
    def merge_segments(self, segments, padding_seconds=3.0):
        """
        Merge close segments and add padding.
        
        Args:
            segments: List of segments with start and end times
            padding_seconds: Seconds to add before and after each segment
            
        Returns:
            List of merged segments with padding
        """
        if not segments:
            return []
            
        # Sort segments by start time
        sorted_segments = sorted(segments, key=lambda x: x['start'])
        
        # Add padding to each segment
        padded_segments = []
        for segment in sorted_segments:
            padded_segments.append({
                'start': max(0, segment['start'] - padding_seconds),
                'end': segment['end'] + padding_seconds,
                'text': segment.get('text', '')
            })
        
        # Merge overlapping segments
        merged_segments = []
        current = padded_segments[0]
        
        for next_segment in padded_segments[1:]:
            # If segments overlap, merge them
            if next_segment['start'] <= current['end']:
                current['end'] = max(current['end'], next_segment['end'])
                current['text'] = current['text'] + ' ' + next_segment['text']
            else:
                merged_segments.append(current)
                current = next_segment
        
        # Add the last segment
        merged_segments.append(current)
        
        return merged_segments
    
    def trim_to_highlights(self, file_path: Union[str, Path], segments) -> str:
        """
        Create a highlight reel from multiple segments of an audio file.
        
        Args:
            file_path: Path to the audio file
            segments: List of segments with start and end times to include
            
        Returns:
            Path to the output file
        """
        try:
            if not segments:
                raise ValueError("No segments provided for trimming")
                
            # Ensure file exists
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
            
            file_path = Path(file_path)
            
            # Create output file path
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = file_path.parent
            output_filename = f"{file_path.stem}_highlights_{timestamp}{file_path.suffix}"
            output_path = output_dir / output_filename
            
            # Check if we need to create a temp file for intermediate steps
            if len(segments) == 1:
                # Just one segment, use the trim method
                return self.trim_audio(file_path, segments[0]['start'], segments[0]['end'])
            
            # For multiple segments, we'll use pydub to concatenate
            audio = AudioSegment.from_file(str(file_path))
            
            # Extract and concatenate segments
            output_audio = AudioSegment.empty()
            for segment in segments:
                start_ms = int(segment['start'] * 1000)
                end_ms = int(segment['end'] * 1000)
                
                # Validate time bounds
                start_ms = max(0, start_ms)
                end_ms = min(len(audio), end_ms)
                
                if start_ms >= end_ms:
                    logger.warning(f"Invalid segment: start {start_ms}ms >= end {end_ms}ms, skipping")
                    continue
                
                # Extract segment and add to output
                segment_audio = audio[start_ms:end_ms]
                output_audio += segment_audio
            
            # Export the concatenated audio
            output_audio.export(str(output_path), format=file_path.suffix[1:])
            
            logger.info(f"Created highlights audio file: {output_path}")
            return str(output_path)
            
        except Exception as e:
            logger.error(f"Error creating highlights: {str(e)}")
            raise
