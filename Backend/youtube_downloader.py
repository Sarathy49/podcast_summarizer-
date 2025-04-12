import os
import logging
import tempfile
from pathlib import Path
from typing import Dict, Union, Optional, Tuple
import json
import re
import yt_dlp
import hashlib
import urllib.parse

# Set up logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class YouTubeDownloader:
    """
    YouTube downloader specifically for fetching podcast audio from YouTube.
    Focuses on extracting high-quality audio while ignoring video content.
    """
    
    def __init__(self, download_dir: Optional[Union[str, Path]] = None):
        """
        Initialize the YouTube podcast downloader.
        
        Args:
            download_dir: Optional directory to save downloads to. If not provided,
                          downloads will need an explicit directory.
        """
        self.metadata = {}
        self.temp_files = []  # Keep track of temporary files for cleanup
        
        # Store download directory if provided
        if download_dir:
            self.download_dir = Path(download_dir)
            os.makedirs(self.download_dir, exist_ok=True)
        else:
            self.download_dir = None
    
    def __del__(self):
        """
        Clean up any temporary files when object is destroyed.
        """
        self.cleanup()
    
    def cleanup(self):
        """
        Clean up any temporary files created during download.
        """
        for temp_file in self.temp_files:
            try:
                if os.path.exists(temp_file):
                    logger.info(f"Removing temporary file: {temp_file}")
                    os.unlink(temp_file)
            except Exception as e:
                logger.warning(f"Failed to remove temporary file {temp_file}: {str(e)}")
        self.temp_files = []
    
    def validate_url(self, url: str) -> Tuple[bool, Optional[str]]:
        """
        Validate if the provided URL is a valid YouTube URL.
        
        Args:
            url: URL to validate
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        if not url or not isinstance(url, str):
            return False, "URL is required and must be a string"
            
        # Basic URL validation
        try:
            parsed_url = urllib.parse.urlparse(url)
            if not all([parsed_url.scheme, parsed_url.netloc]):
                return False, "Invalid URL format"
                
            # Check if it's a YouTube domain
            if not any(domain in parsed_url.netloc for domain in ["youtube.com", "youtu.be", "youtube", "ytimg.com"]):
                return False, "URL is not from a recognized YouTube domain"
                
            # Try to extract video ID as final validation
            video_id = self._extract_video_id(url)
            if not video_id or len(video_id) != 11:
                return False, "Could not extract valid YouTube video ID from URL"
                
            return True, None
        except Exception as e:
            return False, f"URL validation error: {str(e)}"
    
    def download(self, url: str, download_dir: Path) -> Path:
        """
        Download audio from a YouTube podcast episode.
        
        Args:
            url: YouTube URL of the podcast episode
            download_dir: Directory to save the downloaded audio
            
        Returns:
            Path to the downloaded audio file.
        """
        # Validate URL
        is_valid, error_message = self.validate_url(url)
        if not is_valid:
            raise ValueError(f"Invalid YouTube URL: {error_message}")
            
        # Create download directory if it doesn't exist
        os.makedirs(download_dir, exist_ok=True)
        
        # Extract video ID - support both regular YouTube and Shorts URLs
        video_id = self._extract_video_id(url)
            
        output_template = str(download_dir / f"podcast_{video_id}.%(ext)s")
        
        # Configure yt-dlp options for optimal audio quality
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': output_template,
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
        }
        
        try:
            # Download the audio
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                logger.info(f"Downloading podcast audio from YouTube: {url}")
                info = ydl.extract_info(url, download=True)
                self.metadata = info
            
            # Find the downloaded file
            expected_output = download_dir / f"podcast_{video_id}.mp3"
            if expected_output.exists():
                return expected_output
                
            # If the expected output doesn't exist, look for any file that matches the pattern
            for file in download_dir.glob(f"podcast_{video_id}.*"):
                return file
                
            raise FileNotFoundError(f"Downloaded audio file not found for podcast ID: {video_id}")
            
        except yt_dlp.utils.DownloadError as e:
            error_msg = str(e)
            if "This video is unavailable" in error_msg:
                logger.error(f"The YouTube video is unavailable or private: {error_msg}")
                raise ValueError(f"The YouTube video is unavailable or private. Please check if the video exists and is public.")
            elif "Video unavailable" in error_msg:
                logger.error(f"The YouTube video is unavailable: {error_msg}")
                raise ValueError(f"The YouTube video is unavailable. It may have been removed or is region-restricted.")
            elif "Sign in" in error_msg:
                logger.error(f"The YouTube video requires authentication: {error_msg}")
                raise ValueError(f"The YouTube video requires authentication. Age-restricted or private videos cannot be downloaded.")
            else:
                logger.error(f"Error downloading podcast audio: {error_msg}")
                raise ValueError(f"Error downloading from YouTube: {error_msg}")
        except Exception as e:
            logger.error(f"Error downloading podcast audio: {str(e)}")
            raise
    
    def _extract_video_id(self, url: str) -> str:
        """
        Extract YouTube video ID from URL supporting various formats.
        
        Args:
            url: YouTube URL
            
        Returns:
            YouTube video ID
        """
        patterns = [
            r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/e\/|youtube\.com\/user\/.*\/.*\/|youtube\.com\/user\/.*\?v=|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/\?v=|youtube\.com\/watch\?.*v=)([^&\n?#]+)',
            r'(?:youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        
        # If URL doesn't match pattern, assume it's a video ID or generate hash
        if re.match(r'^[A-Za-z0-9_-]{11}$', url):
            return url
        else:
            # Use a hash of the URL as fallback
            return hashlib.md5(url.encode()).hexdigest()[:11]
    
    def get_metadata(self) -> dict:
        """
        Get metadata from the downloaded podcast.
        
        Returns:
            Dictionary with podcast metadata
        """
        if not self.metadata:
            return {
                "title": "",
                "channel": "",
                "view_count": 0,
                "upload_date": "",
                "duration": 0,
                "thumbnail": "",
                "description": "",
            }
            
        return {
            "title": self.metadata.get("title", ""),
            "channel": self.metadata.get("uploader", ""),
            "view_count": self.metadata.get("view_count", 0),
            "upload_date": self.metadata.get("upload_date", ""),
            "duration": self.metadata.get("duration", 0),
            "thumbnail": self.metadata.get("thumbnail", ""),
            "description": self.metadata.get("description", ""),
        }
    
    def download_audio(self, url: str) -> Dict:
        """
        Download audio from a YouTube video and return relevant metadata.
        
        Args:
            url: YouTube URL of the video
            
        Returns:
            Dictionary containing file_path and metadata
        """
        if not self.download_dir:
            raise ValueError("No download directory specified. Either provide one during initialization or use the download method directly.")
            
        try:
            # Download the audio file
            file_path = self.download(url, self.download_dir)
            
            # Get metadata
            metadata = self.get_metadata()
            
            # Return result dictionary
            return {
                "file_path": str(file_path),
                "title": metadata.get("title", ""),
                "uploader": metadata.get("channel", ""),
                "duration": metadata.get("duration", 0),
                "error": None
            }
        except Exception as e:
            logger.error(f"Error downloading audio from YouTube: {str(e)}")
            return {
                "error": str(e),
                "file_path": None
            } 
