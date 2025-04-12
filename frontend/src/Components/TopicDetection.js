import { useState, useEffect } from 'react';
import { Tag, ArrowRight, Pin, Sparkles, AlertTriangle } from 'lucide-react';

const TopicDetection = ({ topics = [], isLoading = false }) => {
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [animatedTopics, setAnimatedTopics] = useState([]);

  // Check if topics contains error messages
  const hasError = Array.isArray(topics) && 
                  topics.some(t => typeof t === 'string' && 
                              (t.startsWith('Error:') || 
                               t.includes('error') || 
                               t.includes('timed out')));

  // Filter out error messages and empty topics
  const filteredTopics = Array.isArray(topics) ? 
    topics.filter(t => t && 
                    (typeof t !== 'string' || 
                     (!t.startsWith('Error:') && 
                      !t.includes('error') && 
                      !t.includes('timed out')))) : 
    [];

  // Stagger animation of topics for visual effect
  useEffect(() => {
    if (filteredTopics && filteredTopics.length > 0 && animatedTopics.length === 0) {
      const timer = setTimeout(() => {
        filteredTopics.forEach((_, index) => {
          setTimeout(() => {
            setAnimatedTopics(prev => prev.concat(index));
          }, index * 150);
        });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [filteredTopics]);

  // Display loading state
  if (isLoading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
        <div className="flex items-center mb-4">
          <Tag className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Main Topics</h2>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-slate-700/60 rounded w-3/4"></div>
          <div className="h-5 bg-slate-700/60 rounded w-2/3"></div>
          <div className="h-5 bg-slate-700/60 rounded w-4/5"></div>
        </div>
      </div>
    );
  }

  // Handle the case when no topics are available
  if (!filteredTopics || filteredTopics.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
        <div className="flex items-center mb-4">
          <Tag className="mr-3 text-blue-400" size={18} />
          <h2 className="text-lg font-medium text-slate-200">Main Topics</h2>
        </div>
        <div className="text-slate-400 text-sm p-3 bg-slate-800/70 rounded-lg border border-slate-700/50">
          {hasError ? (
            <div className="flex items-start">
              <AlertTriangle size={16} className="text-amber-400 mr-2 mt-0.5 flex-shrink-0" />
              <p className="text-amber-300">Unable to detect topics for this content.</p>
            </div>
          ) : (
            <p className="flex items-center">
              <Tag className="mr-2 text-slate-500" size={16} />
              No topics were detected in this podcast.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Process topics to ensure they have a valid structure for rendering
  const processedTopics = filteredTopics.map(topic => {
    // If topic is already a string, return simple object with name
    if (typeof topic === 'string') {
      return { name: topic };
    }
    
    // If topic is an object, extract relevant fields
    if (typeof topic === 'object' && topic !== null) {
      // Get the topic name (could be in different fields depending on API)
      const name = topic.name || topic.label || topic.title || 
                 (topic.id ? `Topic ${topic.id}` : 'Unnamed Topic');
      
      // Get keywords and other properties
      const keywords = Array.isArray(topic.keywords) 
        ? topic.keywords 
        : Array.isArray(topic.improved_keywords)
          ? topic.improved_keywords
          : [];
          
      // Convert keywords to strings if they're objects
      const processedKeywords = keywords.map(keyword => 
        typeof keyword === 'object' ? (keyword.text || keyword.word || String(keyword)) : String(keyword)
      );
      
      // Get mentions or sample text
      const mentions = topic.mentions || 
                     (topic.sample_text ? [topic.sample_text] : []);
                     
      // Get score
      const score = typeof topic.score === 'number' ? topic.score : null;
      
      // Get description
      const description = typeof topic.description === 'string' ? topic.description : null;
      
      return {
        name,
        keywords: processedKeywords,
        mentions: Array.isArray(mentions) ? mentions : [String(mentions)],
        score,
        description
      };
    }
    
    // Fallback for any other type
    return { name: 'Unknown Topic' };
  });

  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/40 shadow-lg">
      <div className="flex items-center mb-4">
        <Tag className="mr-3 text-blue-400" size={18} />
        <h2 className="text-lg font-medium text-slate-200">Main Topics</h2>
      </div>
      
      <div className="space-y-3">
        {processedTopics.map((topic, index) => {
          const isExpanded = expandedTopic === index;
          const isAnimated = animatedTopics.includes(index);
          
          return (
            <div 
              key={`topic-${index}`}
              className={`rounded-lg border border-slate-700/40 bg-slate-800/80 overflow-hidden transition-all duration-300 ${
                isAnimated ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              <div 
                onClick={() => setExpandedTopic(isExpanded ? null : index)}
                className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-700/30 transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Tag className="text-blue-400" size={16} />
                  <span className="font-medium text-slate-200">
                    {topic.name}
                    {topic.score !== null && (
                      <span className="ml-2 text-xs text-slate-400">
                        ({Math.round(topic.score * 100)}%)
                      </span>
                    )}
                  </span>
                </div>
                <ArrowRight className={`text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} size={16} />
              </div>
              
              {isExpanded && (
                <div className="px-4 pb-4 text-sm text-slate-300 space-y-3 animate-slideDown">
                  {topic.description && (
                    <p className="text-slate-300 mt-2 italic">{topic.description}</p>
                  )}
                  
                  {topic.keywords && topic.keywords.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase text-slate-500 mb-2 font-semibold flex items-center">
                        <Sparkles size={14} className="mr-1" />
                        Key Terms
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {topic.keywords.map((keyword, kidx) => (
                          <span 
                            key={`kw-${kidx}`} 
                            className="bg-blue-900/30 text-blue-300 px-2 py-1 rounded-md text-xs border border-blue-600/30"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {topic.mentions && topic.mentions.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase text-slate-500 mb-2 font-semibold flex items-center">
                        <Pin size={14} className="mr-1" />
                        Mentions
                      </div>
                      <div className="bg-slate-800/50 rounded p-2 border border-slate-700/50">
                        <ul className="list-disc list-inside space-y-1 text-xs text-slate-400">
                          {topic.mentions.map((mention, midx) => (
                            <li key={`mention-${midx}`}>
                              {typeof mention === 'string' ? mention : 'Sample text'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TopicDetection; 