import logging
import nltk
from typing import List, Optional
import torch
import re
import os

# Set up logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Download NLTK packages if needed
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

# Check for punkt_tab
try:
    nltk.data.find('tokenizers/punkt_tab')
except LookupError:
    try:
        nltk.download('punkt_tab')
    except:
        logger.warning("Could not download punkt_tab, will use punkt instead")

# Check for transformers and sumy
try:
    from transformers import T5ForConditionalGeneration, T5Tokenizer
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    logger.warning("Transformers not available; abstractive summarization will be limited")
    TRANSFORMERS_AVAILABLE = False

try:
    from sumy.parsers.plaintext import PlaintextParser
    from sumy.nlp.tokenizers import Tokenizer
    from sumy.summarizers.text_rank import TextRankSummarizer
    SUMY_AVAILABLE = True
except ImportError:
    logger.warning("Sumy not available; extractive summarization will be limited")
    SUMY_AVAILABLE = False

# Common utility function for transcript cleaning
def clean_transcript(text: str) -> str:
    """
    Clean transcript text by removing speaker labels and timestamps.
    
    Args:
        text: Input transcript text
        
    Returns:
        Cleaned text
    """
    # Remove speaker labels and timestamps like "Speaker 1 [00:01 - 00:05]: "
    cleaned = re.sub(r'Speaker \d+\s+\[\d+:\d+\s+-\s+\d+:\d+\]:\s+', '', text)
    
    # Remove any other timestamp formats like [00:00:00]
    cleaned = re.sub(r'\[\d+:\d+(?::\d+)?\]', '', cleaned)
    
    return cleaned

class ExtractiveSummarizer:
    """
    Extractive summarization using TextRank algorithm.
    """
    
    def __init__(self, language: str = "english", sentence_count: int = 20):
        """
        Initialize the extractive summarizer.
        
        Args:
            language: Language for the tokenizer
            sentence_count: Number of sentences to extract
        """
        self.language = language
        self.sentence_count = sentence_count
        
        if SUMY_AVAILABLE:
            self.summarizer = TextRankSummarizer()
        else:
            self.summarizer = None
    
    def summarize(self, text: str) -> str:
        """
        Extract key sentences from the text.
        
        Args:
            text: Input text to summarize
            
        Returns:
            Dictionary containing extractive summary
        """
        if not SUMY_AVAILABLE:
            return self._fallback_summarize(text)
            
        try:
            logger.info("Generating extractive summary...")
            
            # Clean the text by removing speaker labels and timestamps if present
            cleaned_text = clean_transcript(text)
            
            # Parse the text
            try:
                parser = PlaintextParser.from_string(cleaned_text, Tokenizer(self.language))
                
                # Generate summary
                summary = self.summarizer(parser.document, self.sentence_count)
                
                # Join the sentences
                summary_text = " ".join([str(sentence) for sentence in summary])
                
                logger.info(f"Extractive summary generated: {len(summary_text)} characters")
                
                # If there's no content in the summary, use the fallback
                if not summary_text.strip():
                    return self._fallback_summarize(text)
                
                # Convert to a list of points for better display in the UI
                summary_points = []
                for sentence in summary:
                    if str(sentence).strip():
                        summary_points.append(str(sentence).strip())
                
                return {"summary": summary_points or ["No key points could be extracted."]}
            except LookupError:
                # If punkt_tab is not available, use fallback method
                logger.warning("Error with NLTK tokenizer, using fallback method")
                return self._fallback_summarize(cleaned_text)
            
        except Exception as e:
            logger.error(f"Error during extractive summarization: {str(e)}")
            return self._fallback_summarize(text)
    
    def _fallback_summarize(self, text: str) -> str:
        """
        Simple fallback summarization by extracting first few sentences.
        
        Args:
            text: Input text
            
        Returns:
            Simple summary dictionary
        """
        try:
            # Clean the text
            cleaned_text = clean_transcript(text)
            
            # Split into sentences using regex to avoid NLTK dependency
            sentences = re.split(r'(?<=[.!?])\s+', cleaned_text)
            
            # Get first N sentences (up to 20% of the original text or at least 3 sentences)
            num_sentences = max(3, min(10, int(len(sentences) * 0.2)))
            
            # Create summary points from individual sentences
            summary_points = []
            for i in range(min(num_sentences, len(sentences))):
                if sentences[i].strip():
                    summary_points.append(sentences[i].strip())
            
            if not summary_points:
                # If no valid points, add a default message
                summary_points = ["No key points could be extracted."]
            
            logger.info(f"Fallback extractive summary generated: {len(summary_points)} points")
            return {"summary": summary_points}
        except Exception as e:
            logger.error(f"Fallback summarization failed: {str(e)}")
            return {"summary": ["Could not generate summary for this content."]}

class AbstractiveSummarizer:
    """
    Abstractive summarization using T5 model.
    """
    
    def __init__(self, model_name: str = "t5-small", max_length: int = 512):
        """
        Initialize the abstractive summarizer.
        
        Args:
            model_name: Name of the T5 model to use
            max_length: Maximum length of the generated summary
        """
        self.model_name = model_name
        self.max_length = max_length
        self._model = None
        self._tokenizer = None
        self._model_available = TRANSFORMERS_AVAILABLE
        
        # Try to initialize the model
        if self._model_available:
            try:
                # Just load the tokenizer to see if the model is available
                _ = T5Tokenizer.from_pretrained(self.model_name)
            except Exception as e:
                logger.warning(f"Failed to initialize model: {e}")
                self._model_available = False
    
    @property
    def model(self):
        """Lazy load the T5 model"""
        if self._model is None and self._model_available:
            try:
                logger.info(f"Loading {self.model_name} model...")
                self._model = T5ForConditionalGeneration.from_pretrained(self.model_name)
                
                # Use GPU if available
                if torch.cuda.is_available() and os.environ.get("ENABLE_GPU", "true").lower() == "true":
                    self._model = self._model.to("cuda").eval()
                    # For faster inference, use half precision
                    if self.model_name != "t5-small":  # Skip for small model as it might hurt quality
                        self._model = self._model.half()
                    
                logger.info(f"{self.model_name} model loaded successfully.")
            except Exception as e:
                logger.error(f"Error loading model: {str(e)}")
                self._model_available = False
                
        return self._model
    
    @property
    def tokenizer(self):
        """Lazy load the T5 tokenizer"""
        if self._tokenizer is None and self._model_available:
            try:
                logger.info(f"Loading {self.model_name} tokenizer...")
                self._tokenizer = T5Tokenizer.from_pretrained(self.model_name)
                logger.info(f"{self.model_name} tokenizer loaded successfully.")
            except Exception as e:
                logger.error(f"Error loading tokenizer: {str(e)}")
                self._model_available = False
                
        return self._tokenizer
    
    def summarize(self, text: str, max_input_length: int = 1024) -> str:
        """
        Generate an abstractive summary of the text.
        
        Args:
            text: Input text to summarize
            max_input_length: Maximum length of input text to process
            
        Returns:
            Dictionary containing abstractive summary
        """
        if not self._model_available:
            return self._fallback_summarize(text)
        
        try:
            logger.info(f"Generating abstractive summary using {self.model_name}...")
            
            # Clean the text
            cleaned_text = clean_transcript(text)
            
            # For very short texts, return a simple response
            if len(cleaned_text.split()) < 20:
                return {"summary": "The content is too short for a meaningful summary."}
            
            # Check if text is longer than max_input_length
            if len(cleaned_text.split()) > max_input_length:
                logger.info(f"Text too long ({len(cleaned_text.split())} words), using chunking approach")
                return self._summarize_long_text(cleaned_text)
            
            # If text is very long, use optimized long text processing
            if len(cleaned_text.split()) > 600:
                return self._summarize_long_text(cleaned_text)
            
            # Prepare input text
            input_text = f"summarize: {cleaned_text}"
            
            # Tokenize input
            input_ids = self.tokenizer.encode(
                input_text, 
                return_tensors="pt", 
                max_length=max_input_length, 
                truncation=True
            )
            
            # Move to GPU if available
            if torch.cuda.is_available() and os.environ.get("ENABLE_GPU", "true").lower() == "true":
                input_ids = input_ids.to("cuda")
            
            # Use optimized inference configuration
            with torch.no_grad():
                # Set up generation parameters for faster inference
                output = self.model.generate(
                    input_ids,
                    max_length=self.max_length,
                    num_beams=2,  # Lower beam search width for faster processing
                    early_stopping=True,
                    length_penalty=0.8,  # Slightly prefer shorter output
                    no_repeat_ngram_size=2,
                    temperature=0.7  # Slightly increase randomness
                )
            
            # Decode the output
            summary = self.tokenizer.decode(output[0], skip_special_tokens=True)
            
            # If summary is empty or too short, use fallback
            if not summary.strip() or len(summary.strip()) < 10:
                return self._fallback_summarize(text)
            
            logger.info(f"Abstractive summary generated: {len(summary)} characters")
            return {"summary": summary}
            
        except Exception as e:
            logger.error(f"Error during abstractive summarization: {str(e)}")
            return self._fallback_summarize(text)
    
    def _fallback_summarize(self, text: str) -> str:
        """
        Simple fallback summarization by extracting first few sentences.
        
        Args:
            text: Input text
            
        Returns:
            Simple summary dictionary
        """
        try:
            # Clean the text
            cleaned_text = clean_transcript(text)
            
            # For very short texts, return a simple response
            if len(cleaned_text.split()) < 20:
                return {"summary": "The content is too short for a meaningful summary."}
            
            # Split into sentences using regex
            sentences = re.split(r'(?<=[.!?])\s+', cleaned_text)
            
            # If only a few sentences, just use them
            if len(sentences) <= 4:
                return {"summary": " ".join(sentences)}
            
            # Get first few sentences
            first_sentences = " ".join(sentences[:3])
            
            # Get some middle sentences
            mid_start = max(3, len(sentences) // 2 - 1)
            mid_sentences = " ".join(sentences[mid_start:mid_start + 2])
            
            # Get last sentences
            last_sentences = " ".join(sentences[-2:])
            
            summary = f"{first_sentences} [...] {mid_sentences} [...] {last_sentences}"
            
            logger.info(f"Fallback abstractive summary generated: {len(summary)} characters")
            return {"summary": summary}
        except Exception as e:
            logger.error(f"Fallback summarization failed: {str(e)}")
            return {"summary": "Unable to generate summary for this content."}
    
    def _summarize_long_text(self, text: str) -> dict:
        """
        Summarize a long text by breaking it into chunks.
        
        Args:
            text: Long input text
            
        Returns:
            Summary dictionary of the long text
        """
        try:
            # Clean the text
            cleaned_text = clean_transcript(text)
            
            # Split into sentences
            sentences = re.split(r'(?<=[.!?])\s+', cleaned_text)
            
            if len(sentences) <= 10:
                # If not many sentences, use regular summarization
                return self._summarize_chunk(cleaned_text)
            
            # Determine chunk size: try to create 3-5 chunks
            chunks_target = min(5, max(3, len(sentences) // 200))
            chunk_size = max(10, len(sentences) // chunks_target)
            
            # Create chunks of sentences
            chunks = []
            for i in range(0, len(sentences), chunk_size):
                chunk = " ".join(sentences[i:i+chunk_size])
                if chunk.strip():  # Only add non-empty chunks
                    chunks.append(chunk)
            
            logger.info(f"Split text into {len(chunks)} chunks for processing")
            
            # Process each chunk with max worker threads for better parallelism
            import concurrent.futures
            
            # Calculate optimal workers based on chunks and available CPUs
            max_workers = min(len(chunks), os.cpu_count() or 4)
            
            chunk_summaries = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_chunk = {executor.submit(self._summarize_chunk, chunk): i for i, chunk in enumerate(chunks)}
                
                for future in concurrent.futures.as_completed(future_to_chunk):
                    chunk_idx = future_to_chunk[future]
                    try:
                        summary_dict = future.result()
                        summary = summary_dict.get("summary", "")
                        chunk_summaries.append((chunk_idx, summary))
                    except Exception as e:
                        logger.error(f"Error summarizing chunk {chunk_idx}: {e}")
                        # Use a fallback for failed chunks
                        chunk_text = chunks[chunk_idx]
                        sentences = re.split(r'(?<=[.!?])\s+', chunk_text)
                        fallback = " ".join(sentences[:2]) + " [...] " + " ".join(sentences[-2:])
                        chunk_summaries.append((chunk_idx, fallback))
            
            # Sort by original order and join
            chunk_summaries.sort()
            intermediate_summary = " ".join([summary for _, summary in chunk_summaries])
            
            # If the intermediate summary is still long, summarize it again
            if len(intermediate_summary.split()) > 500:
                logger.info("Intermediate summary still long, summarizing again")
                final_summary_dict = self._summarize_chunk(intermediate_summary)
                return final_summary_dict
            else:
                return {"summary": intermediate_summary}
                
        except Exception as e:
            logger.error(f"Long text summarization failed: {str(e)}")
            return self._fallback_summarize(text)
    
    def _summarize_chunk(self, chunk: str) -> dict:
        """
        Summarize a single chunk of text.
        
        Args:
            chunk: Text chunk to summarize
            
        Returns:
            Dictionary containing summary of the chunk
        """
        try:
            # Check if chunk is too short
            if len(chunk.split()) < 30:
                return {"summary": chunk}
                
            # Prepare input text
            input_text = f"summarize: {chunk}"
            
            # Tokenize
            input_ids = self.tokenizer.encode(
                input_text, 
                return_tensors="pt", 
                max_length=1024, 
                truncation=True
            )
            
            # Move to GPU if available
            if torch.cuda.is_available() and os.environ.get("ENABLE_GPU", "true").lower() == "true":
                input_ids = input_ids.to("cuda")
            
            # Generate summary
            with torch.no_grad():
                output = self.model.generate(
                    input_ids,
                    max_length=150,
                    num_beams=2,
                    early_stopping=True,
                    no_repeat_ngram_size=2
                )
            
            # Decode
            summary = self.tokenizer.decode(output[0], skip_special_tokens=True)
            
            # If summary is too short or empty, return original text
            if not summary.strip() or len(summary.strip()) < 10:
                return {"summary": chunk[:500] + " [...]"}
                
            return {"summary": summary}
            
        except Exception as e:
            logger.error(f"Error summarizing chunk: {str(e)}")
            
            # Fallback to first few and last few sentences
            sentences = re.split(r'(?<=[.!?])\s+', chunk)
            if len(sentences) <= 4:
                return {"summary": chunk}
                
            fallback = " ".join(sentences[:2]) + " [...] " + " ".join(sentences[-2:])
            return {"summary": fallback}
