import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { id } = params;
  
  try {
    // Proxy the request to the backend server
    const response = await fetch(`http://localhost:8000/api/audio/${id}`, {
      method: 'GET',
      cache: 'no-store', // Ensure we don't cache the audio file
    });
    
    if (!response.ok) {
      console.error(`Error fetching audio file ${id}: ${response.status} ${response.statusText}`);
      return new NextResponse(null, { 
        status: response.status,
        statusText: response.statusText
      });
    }
    
    // Get the audio data as ArrayBuffer
    const audioData = await response.arrayBuffer();
    
    // Get the content type from the response
    const contentType = response.headers.get('content-type') || 'audio/mp4';
    
    // Return the audio data with appropriate headers
    return new NextResponse(audioData, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${id}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching audio:', error);
    return new NextResponse(null, { status: 500 });
  }
} 